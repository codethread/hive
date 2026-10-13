/* eslint-disable unicorn/no-null -- Unknown stdout activity is explicit in the public observation. */
import {
	COLONY_OBSERVATION_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestColonyObservation,
	latestStdoutActivity,
	readSpawnRequest,
} from "@hive/shared";
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

/** Native comments retain observation history and deduplicate unchanged facts across restarts. */
export async function publishObservation(
	{ beads, repository }: TrackerContext,
	id: string,
	fact: string,
): Promise<void> {
	const spawn = await beads.show(trackerScope(repository, "colony"), id);
	assertObservationHost(readSpawnRequest(spawn).host, id);
	const latest = latestColonyObservation(spawn);
	const message = `${COLONY_OBSERVATION_PREFIX} ${fact}`;
	if (latest?.text !== message) {
		await beads.comments.add(trackerScope(repository, "colony"), id, message);
	}
}

/** Awake reconciliation publishes metadata only; detached workers retain their existing authority. */
export async function publishStdoutActivity(
	{ beads, repository }: TrackerContext,
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">,
	final = false,
): Promise<void> {
	const spawn = await beads.show(trackerScope(repository, "colony"), receipt.spawnId);
	assertObservationHost(readSpawnRequest(spawn).host, receipt.spawnId);
	const activity: StdoutActivity = {
		attemptId: receipt.id,
		attemptNumber: receipt.attemptNumber,
		lastOutputAt: await readStdoutActivity(receipt.directory),
		recordedAt: new Date().toISOString(),
	};
	if (stdoutActivityDue(latestStdoutActivity(spawn), activity, final)) {
		await beads.comments.add(
			trackerScope(repository, "colony"),
			receipt.spawnId,
			`${COLONY_STDOUT_PREFIX} ${JSON.stringify(activity)}`,
		);
	}
}

/** Initial evidence and settlement publish immediately; unchanged output never makes a heartbeat. */
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
function assertObservationHost(host: string | null, id: string): void {
	if (host !== hostname()) {
		throw new Error(`Request ${id} is not bound to observing host ${hostname()}`);
	}
}
