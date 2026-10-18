/* eslint-disable unicorn/no-null -- Null denotes an absent receipt, never verified clearance. */
import { BeeswaxError, errorMessage } from "../errors.ts";
import { parseDatabase } from "./environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Normalize an explicit endpoint without accessing SQLite.
import { resolve } from "node:path";
import { z } from "zod";

const NONEMPTY = 1;
const RECEIPT_VERSION = 1;
const NEXT_GENERATION = 1;
const POLL_MS = 250;
const SECOND_MS = 1000;
const MAX_WAIT_SECONDS = 3600;
const ZERO = 0;
const incidentFields = {
	id: z.string().min(NONEMPTY),
	generation: z.number().int().positive(),
	reason: z.string().min(NONEMPTY),
	raisedAt: z.iso.datetime(),
};

export const trackerAlertSchema = z.discriminatedUnion("state", [
	z.strictObject({ ...incidentFields, state: z.literal("active") }),
	z.strictObject({
		...incidentFields,
		state: z.literal("cleared"),
		clearedAt: z.iso.datetime(),
		evidence: z.string().trim().min(NONEMPTY),
	}),
]);
export const trackerAlertObservationSchema = z.strictObject({
	ok: z.literal(true),
	kind: z.literal("tracker_alert"),
	database: z.string(),
	alert: trackerAlertSchema.nullable(),
});
export const trackerRecoveryHandoffSchema = trackerAlertObservationSchema
	.pick({ database: true, alert: true })
	.extend({
		ok: z.literal(true),
		kind: z.literal("tracker_recovery_handoff"),
		requiresUser: z.literal(true),
		prerequisites: z.array(z.string()),
		instructions: z.literal("beeswax skills get tracker-recovery"),
	});
export const trackerAlertReceiptSchema = z.strictObject({
	version: z.literal(RECEIPT_VERSION),
	database: z.string(),
	alert: trackerAlertSchema,
});
const receiptParser = z.compile(trackerAlertReceiptSchema);
export const alertWaitSecondsSchema = z.coerce.number().finite().min(ZERO).max(MAX_WAIT_SECONDS);

export type TrackerAlert = z.infer<typeof trackerAlertSchema>;
export type TrackerAlertObservation = z.infer<typeof trackerAlertObservationSchema>;

export interface AlertStore {
	/** Read only independent alert state; missing state remains unverified. */
	observe: (database: string) => Promise<TrackerAlertObservation>;
	/** Record a new incident under the endpoint's serialized state transition. */
	activate: (database: string, reason: string) => Promise<TrackerAlertObservation>;
	/** Retain clearance evidence only when the exact incident is still active. */
	clear: (database: string, id: string, evidence: string) => Promise<TrackerAlertObservation>;
}

export interface AlertStorage {
	/** Read the selected endpoint's receipt; only ENOENT is absence. */
	read: (database: string) => Promise<string | undefined>;
	/** Atomically replace the endpoint's receipt with a complete document. */
	write: (database: string, contents: string) => Promise<void>;
	/** Serialize transitions for this endpoint, independently of SQLite. */
	withLock: <Result>(database: string, action: () => Promise<Result>) => Promise<Result>;
	/** New incident identity. */
	id: () => string;
	/** Receipt timestamp. */
	now: () => string;
}

export interface AlertWaitClock {
	/** Monotonic milliseconds. */
	now: () => number;
	/** Wait without any tracker access. */
	sleep: (milliseconds: number) => Promise<void>;
}

/** Resolve endpoint identity without checking or opening the native database. */
export function alertDatabase(value: string): string {
	return resolve(parseDatabase(value));
}

/** Application transitions retain one current incident/clearance receipt per selected endpoint. */
export function createAlertStore(storage: AlertStorage): AlertStore {
	const observe = async (selected: string): Promise<TrackerAlertObservation> => {
		const database = alertDatabase(selected);
		const contents = await storage.read(database).catch((error: unknown) => {
			throw stateFailure(database, error);
		});
		if (contents === undefined) {
			return observation(database, null);
		}
		try {
			const receipt = receiptParser.parse(JSON.parse(contents));
			if (receipt.database !== database) {
				throw new Error("Alert receipt belongs to another database");
			}
			return observation(database, receipt.alert);
		} catch (error) {
			throw new BeeswaxError(
				"tracker_alert_invalid",
				`Invalid tracker alert state: ${errorMessage(error)}`,
				{
					context: { database },
				},
			);
		}
	};
	const transition = async (
		selected: string,
		update: (current: TrackerAlert | null) => TrackerAlert,
	): Promise<TrackerAlertObservation> => {
		const database = alertDatabase(selected);
		try {
			return await storage.withLock(database, async () => {
				const current = await observe(database);
				const alert = update(current.alert);
				await storage.write(
					database,
					JSON.stringify({ version: RECEIPT_VERSION, database, alert }),
				);
				return observation(database, alert);
			});
		} catch (error) {
			if (error instanceof BeeswaxError) {
				throw error;
			}
			throw stateFailure(database, error);
		}
	};
	return {
		observe,
		activate: (database, reason) =>
			transition(database, (current) => ({
				id: storage.id(),
				generation: (current?.generation ?? ZERO) + NEXT_GENERATION,
				state: "active",
				reason,
				raisedAt: storage.now(),
			})),
		clear: (database, id, evidence) =>
			transition(database, (current) => {
				if (current?.state !== "active" || current.id !== id) {
					throw new BeeswaxError(
						"tracker_alert_changed",
						"The recovery incident is no longer current.",
						{
							context: { database, incident: id, alert: current },
						},
					);
				}
				return { ...current, state: "cleared", clearedAt: storage.now(), evidence };
			}),
	};
}

/** Wait for an observed incident to change, retaining unknown absence instead of inventing clearance. */
export async function waitForAlert(
	database: string,
	timeout: number,
	services: Pick<AlertStore, "observe"> & AlertWaitClock,
): Promise<TrackerAlertObservation> {
	const deadline = services.now() + timeout * SECOND_MS;
	const initial = await services.observe(database);
	let current = initial;
	/* eslint-disable no-await-in-loop -- Bounded polling observes only the independent receipt. */
	for (
		let remaining = deadline - services.now();
		remaining > ZERO;
		remaining = deadline - services.now()
	) {
		await services.sleep(Math.min(POLL_MS, remaining));
		current = await services.observe(database);
		if (current.alert?.id !== initial.alert?.id || current.alert?.state !== initial.alert?.state) {
			return current;
		}
	}
	/* eslint-enable no-await-in-loop */
	return current;
}

// --- Private functions ---

function observation(database: string, alert: TrackerAlert | null): TrackerAlertObservation {
	return { ok: true, kind: "tracker_alert", database, alert };
}

function stateFailure(database: string, error: unknown): BeeswaxError {
	return new BeeswaxError(
		"tracker_alert_unavailable",
		`Tracker alert state unavailable: ${errorMessage(error)}`,
		{
			context: { database },
		},
	);
}
