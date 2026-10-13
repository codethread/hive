/* eslint-disable unicorn/no-null -- Persist explicit absence in JSON checkpoints. */
import type { ColonyStatus } from "@hive/shared";
import { repositoryEndpointSchema } from "@hive/shared";
import { z } from "zod";

export const WATCHDOG_POLL_MS = 30_000;
const UNAVAILABLE_GRACE_MS = 60_000;
const NOTIFICATION_COOLDOWN_MS = 1_800_000;

/** Watcher-owned delivery bookkeeping, never scheduling authority. */
export const watchdogCheckpointSchema = z.strictObject({
	/** Failed repository/tracker episodes whose alert was delivered. */
	failures: z.array(repositoryEndpointSchema),
	/** Latest successful notification time in epoch milliseconds, or none yet. */
	lastNotifiedAt: z.number().finite().nullable(),
	/** Sustained transport outage, including whether its alert was delivered. */
	outage: z.strictObject({ since: z.number().finite(), delivered: z.boolean() }).nullable(),
});
export type WatchdogCheckpoint = z.infer<typeof watchdogCheckpointSchema>;
export type WatchdogObservation =
	| { kind: "unavailable" }
	| { kind: "reachable"; colonies: ColonyStatus[] };

export interface WatchdogTransition {
	/** Checkpoint to commit only after any notification succeeds. */
	next: WatchdogCheckpoint;
	/** All changes from this observation, delivered together, or undefined for silence. */
	body: string | undefined;
}

export interface WatchdogIO {
	/** Read the selected daemon without starting it. */
	observe: () => Promise<WatchdogObservation>;
	/** Current epoch milliseconds, including elapsed time across restarts. */
	now: () => number;
	/** Deliver one notification; reject on failure. */
	notify: (body: string) => Promise<void>;
	/** Atomically replace watcher-owned delivery bookkeeping. */
	save: (checkpoint: WatchdogCheckpoint) => Promise<void>;
}

// eslint-disable-next-line max-statements -- One observation advances independent daemon and colony incidents together.
export function advanceWatchdog(
	previous: WatchdogCheckpoint,
	observation: WatchdogObservation,
	now: number,
): WatchdogTransition {
	let { lastNotifiedAt } = previous;
	const canAlert =
		previous.lastNotifiedAt === null || now - previous.lastNotifiedAt >= NOTIFICATION_COOLDOWN_MS;
	if (observation.kind === "unavailable") {
		const outage = previous.outage ?? { delivered: false, since: now };
		const alert = canAlert && !outage.delivered && now - outage.since >= UNAVAILABLE_GRACE_MS;
		let body: string | undefined = undefined;
		if (alert) {
			body = "Colony daemon unavailable for at least 60 seconds.";
			lastNotifiedAt = now;
		}
		return {
			body,
			next: {
				...previous,
				lastNotifiedAt,
				outage: { ...outage, delivered: outage.delivered || alert },
			},
		};
	}
	const failures = new Map(
		previous.failures.map((repository) => [identity(repository), repository]),
	);
	const messages: string[] = [];
	if (previous.outage?.delivered) {
		messages.push("Colony daemon reachable again.");
	}
	for (const colony of observation.colonies) {
		const key = identity(colony.repository);
		const label = `${colony.repository.root} (Beads: ${colony.repository.beadsDb})`;
		if (colony.state === "failed") {
			if (canAlert && !failures.has(key)) {
				messages.push(`Colony failed: ${label}\n${colony.message}`);
				failures.set(key, colony.repository);
			}
		} else if (failures.delete(key)) {
			messages.push(`Colony failure cleared: ${label}\nCurrent state: ${colony.state}.`);
		}
	}
	const body = messages.join("\n\n") || undefined;
	if (body !== undefined) {
		lastNotifiedAt = now;
	}
	return {
		body,
		next: {
			failures: [...failures.values()],
			lastNotifiedAt,
			outage: null,
		},
	};
}

export async function pollWatchdog(
	previous: WatchdogCheckpoint,
	io: WatchdogIO,
): Promise<WatchdogCheckpoint> {
	const observation = await io.observe();
	const transition = advanceWatchdog(previous, observation, io.now());
	let { next } = transition;
	if (transition.body !== undefined) {
		await io.notify(transition.body);
		next = { ...next, lastNotifiedAt: io.now() };
	}
	if (JSON.stringify(previous) !== JSON.stringify(next)) {
		await io.save(next);
	}
	return next;
}

// --- Private functions ---
function identity(repository: ColonyStatus["repository"]): string {
	return JSON.stringify([repository.root, repository.beadsDb]);
}
