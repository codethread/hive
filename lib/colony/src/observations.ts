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

/**
 * Native comments retain history and deduplicate unchanged facts across restarts.
 * A same-phase snapshot can skip a no-op; due publication rereads native authority.
 */
/* eslint-disable-next-line max-params --
 * Pass phase-local detail explicitly rather than retaining a shared cache.
 */
export async function publishObservation(
	{ beads, repository }: TrackerContext,
	id: string,
	fact: string,
	snapshot?: Bead,
): Promise<void> {
	const message = `${COLONY_OBSERVATION_PREFIX} ${fact}`;
	if (snapshot && latestColonyObservation(snapshot)?.text === message) {
		return;
	}
	const spawn = await beads.show(trackerScope(repository, "sys-colony"), id);
	assertObservationAuthority(spawn, snapshot);
	if (snapshot && spawn.status === "closed") {
		return;
	}
	if (latestColonyObservation(spawn)?.text !== message) {
		await beads.comments.add(trackerScope(repository, "sys-colony"), id, message);
	}
}

/**
 * Publish stdout metadata using publishObservation's no-op-only snapshot contract.
 * Return whether a comment was written; callers must discard pre-write snapshots.
 */
/* eslint-disable-next-line max-params, max-statements --
 * Keep final-flush policy, no-op reuse and the publication outcome together.
 */
export async function publishStdoutActivity(
	{ beads, repository }: TrackerContext,
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">,
	final = false,
	snapshot?: Bead,
): Promise<boolean> {
	const activity: StdoutActivity = {
		attemptId: receipt.id,
		attemptNumber: receipt.attemptNumber,
		lastOutputAt: await readStdoutActivity(receipt.directory),
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
