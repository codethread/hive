/* eslint-disable unicorn/no-null -- Unknown stdout activity is explicit in the public observation. */
import {
	COLONY_OBSERVATION_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestColonyObservation,
	latestStdoutActivity,
	readSpawnRequest,
} from "@hive/shared";
import type { Bead } from "@hive/beads";
import type { LaunchReceipt } from "./launch.ts";
import type { StdoutActivity } from "@hive/shared";
import type { TrackerContext } from "./tracker.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Colony cannot publish observations for another machine's requests.
 */
import { hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Inspect the current attempt's owned stdout artifact.
import { join } from "node:path";
/* eslint-disable-next-line import/no-nodejs-modules --
 * File metadata preserves output time across sleep and daemon restart.
 */
import { stat } from "node:fs/promises";
import { trackerScope } from "./tracker.ts";

const STDOUT_PUBLICATION_INTERVAL_MS = 30_000;
const EMPTY = 0;

export interface RunningObservationInput {
	/** Current owned attempt; lifecycle eligibility remains the caller's responsibility. */
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">;
	/** Original detail already checked against retained request authority. */
	snapshot: Bead;
}

export interface RunningStdoutFailure {
	/** Request whose admitted comment failed, possibly after commitment. */
	requestId: string;
	/** Original transport failure, without replacing secondary failures. */
	error: unknown;
}

export class RunningStdoutPublicationError extends AggregateError {
	readonly failures: readonly RunningStdoutFailure[];

	constructor(failures: readonly RunningStdoutFailure[]) {
		super(
			failures.map(({ error }) => error),
			"Running stdout publication failed",
		);
		this.name = "RunningStdoutPublicationError";
		this.failures = failures;
	}
}

export function runningObservationCurrent({ receipt, snapshot }: RunningObservationInput): boolean {
	return (
		latestColonyObservation(snapshot)?.text ===
		`${COLONY_OBSERVATION_PREFIX} running: attempt ${receipt.attemptNumber}`
	);
}

/**
 * Publish stdout for a caller-bounded cohort of distinct, fact-current running requests.
 * Sample logs first; snapshots can skip no-ops, but due IDs need one fresh native gate.
 * Validate all due rows, then immediately start independent writes and drain every result.
 * Rows can age during native hydration and writes can queue; later closure or authority
 * changes can race these historical comments. Admission is neither atomic nor a liveness check.
 */
/* eslint-disable-next-line max-statements -- Keep cohort validation, immediate admission and full drain together. */
export async function publishRunningStdoutActivities(
	{ beads, repository }: TrackerContext,
	inputs: readonly RunningObservationInput[],
	readActivity: typeof readStdoutActivity = readStdoutActivity,
): Promise<void> {
	const sampled = await Promise.all(
		inputs.map(async ({ receipt, snapshot }) => ({
			receipt,
			snapshot,
			activity: {
				attemptId: receipt.id,
				attemptNumber: receipt.attemptNumber,
				lastOutputAt: await readActivity(receipt.directory),
				recordedAt: new Date().toISOString(),
			},
		})),
	);
	const due = sampled.filter(({ snapshot, activity }) =>
		stdoutActivityDue(latestStdoutActivity(snapshot), activity),
	);
	if (due.length === EMPTY) {
		return;
	}
	const scope = trackerScope(repository, "sys-colony");
	const ids = due.map(({ receipt }) => receipt.spawnId);
	const fresh = await beads.showMany(scope, ids);
	const byId = new Map(fresh.map((spawn) => [spawn.id, spawn]));
	if (fresh.length !== ids.length || byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
		throw new Error("Running stdout publication requires complete, unambiguous request detail");
	}
	for (const { receipt, snapshot } of due) {
		assertObservationAuthority(byId.get(receipt.spawnId)!, snapshot);
	}
	const admitted = due
		.filter(({ receipt, activity }) => {
			const spawn = byId.get(receipt.spawnId)!;
			return spawn.status !== "closed" && stdoutActivityDue(latestStdoutActivity(spawn), activity);
		})
		.map(({ receipt, activity }) => ({
			requestId: receipt.spawnId,
			message: `${COLONY_STDOUT_PREFIX} ${JSON.stringify(activity)}`,
		}));
	const pending = admitted.map(({ requestId, message }) => {
		try {
			return beads.comments.add(scope, requestId, message);
		} catch (error) {
			return Promise.reject(error);
		}
	});
	const settled = await Promise.allSettled(pending);
	const failures: RunningStdoutFailure[] = [];
	for (const [index, result] of settled.entries()) {
		if (result.status === "rejected") {
			failures.push({ requestId: admitted[index]!.requestId, error: result.reason });
		}
	}
	if (failures.length !== EMPTY) {
		throw new RunningStdoutPublicationError(failures);
	}
}

/**
 * Publish the running fact before stdout, reusing the caller's authority-checked snapshot for no-ops.
 * A fact write invalidates that snapshot: refresh and verify host, identity, workflow assignment
 * and tasks before stdout eligibility. Stdout still rechecks before writing; no read follows it.
 * The comments are independent historical evidence, not an atomic pair or proof of liveness.
 */
/* eslint-disable-next-line max-params -- Keep the typed stdout reader local to publication orchestration. */
export async function publishRunningObservations(
	context: TrackerContext,
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">,
	snapshot: Bead,
	readActivity: typeof readStdoutActivity = readStdoutActivity,
): Promise<void> {
	let stdoutSnapshot = snapshot;
	if (
		await publishObservation(
			context,
			receipt.spawnId,
			`running: attempt ${receipt.attemptNumber}`,
			snapshot,
		)
	) {
		stdoutSnapshot = await context.beads.show(
			trackerScope(context.repository, "sys-colony"),
			receipt.spawnId,
		);
		assertObservationAuthority(stdoutSnapshot, snapshot);
	}
	await publishStdoutActivity(context, receipt, false, stdoutSnapshot, readActivity);
}

/**
 * Native comments retain history and deduplicate unchanged facts across restarts.
 * A same-phase snapshot can skip a no-op; due publication rereads native authority.
 * Return true only after the awaited comment write succeeds, false for a no-op
 * (including a snapshot-guarded closed request). Errors propagate; a successful write
 * invalidates pre-write snapshots.
 */
/* eslint-disable-next-line max-params --
 * Pass phase-local detail explicitly rather than retaining a shared cache.
 */
export async function publishObservation(
	{ beads, repository }: TrackerContext,
	id: string,
	fact: string,
	snapshot?: Bead,
): Promise<boolean> {
	const message = `${COLONY_OBSERVATION_PREFIX} ${fact}`;
	if (snapshot && latestColonyObservation(snapshot)?.text === message) {
		return false;
	}
	const spawn = await beads.show(trackerScope(repository, "sys-colony"), id);
	assertObservationAuthority(spawn, snapshot);
	if ((snapshot && spawn.status === "closed") || latestColonyObservation(spawn)?.text === message) {
		return false;
	}
	await beads.comments.add(trackerScope(repository, "sys-colony"), id, message);
	return true;
}

/** Use publishObservation's no-op snapshot reuse and write-result contract for stdout metadata. */
/* eslint-disable-next-line max-params, max-statements --
 * Keep final-flush policy, no-op reuse and the publication outcome together.
 */
export async function publishStdoutActivity(
	{ beads, repository }: TrackerContext,
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">,
	final = false,
	snapshot?: Bead,
	readActivity: typeof readStdoutActivity = readStdoutActivity,
): Promise<boolean> {
	const activity: StdoutActivity = {
		attemptId: receipt.id,
		attemptNumber: receipt.attemptNumber,
		lastOutputAt: await readActivity(receipt.directory),
		recordedAt: new Date().toISOString(),
	};
	if (snapshot && !stdoutActivityDue(latestStdoutActivity(snapshot), activity, final)) {
		return false;
	}
	const spawn = await beads.show(trackerScope(repository, "sys-colony"), receipt.spawnId);
	assertObservationAuthority(spawn, snapshot);
	if (snapshot && !final && spawn.status === "closed") {
		return false;
	}
	if (stdoutActivityDue(latestStdoutActivity(spawn), activity, final)) {
		await beads.comments.add(
			trackerScope(repository, "sys-colony"),
			receipt.spawnId,
			`${COLONY_STDOUT_PREFIX} ${JSON.stringify(activity)}`,
		);
		return true;
	}
	return false;
}

/** Initial evidence and settlement bypass the throttle; unchanged output never makes a heartbeat. */
export function stdoutActivityDue(
	previous: StdoutActivity | undefined,
	current: StdoutActivity,
	final = false,
): boolean {
	if (previous?.attemptId !== current.attemptId) {
		return true;
	}
	if (previous.lastOutputAt === current.lastOutputAt) {
		return false;
	}
	return (
		final ||
		previous.lastOutputAt === null ||
		Date.parse(current.recordedAt) - Date.parse(previous.recordedAt) >=
			STDOUT_PUBLICATION_INTERVAL_MS
	);
}

/** Empty or not-yet-created logs are unknown, irrespective of their creation timestamp. */
export async function readStdoutActivity(directory: string): Promise<string | null> {
	try {
		const metadata = await stat(join(directory, "stdout.log"));
		if (metadata.size === EMPTY) {
			return null;
		}
		return metadata.mtime.toISOString();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

// --- Private functions ---
function assertObservationAuthority(spawn: Bead, snapshot?: Bead): void {
	const current = readSpawnRequest(spawn);
	if (current.host !== hostname()) {
		throw new Error(`Request ${spawn.id} is not bound to observing host ${hostname()}`);
	}
	if (snapshot) {
		const captured = readSpawnRequest(snapshot);
		if (
			current.identity !== captured.identity ||
			current.assignment.kind !== captured.assignment.kind ||
			current.assignment.runId !== captured.assignment.runId ||
			(current.assignment.kind === "stage" &&
				captured.assignment.kind === "stage" &&
				current.assignment.stageId !== captured.assignment.stageId) ||
			current.taskIds.length !== captured.taskIds.length ||
			!current.taskIds.every((id) => captured.taskIds.includes(id))
		) {
			throw new Error(`Request ${spawn.id} changed authority before observation publication`);
		}
	}
}
