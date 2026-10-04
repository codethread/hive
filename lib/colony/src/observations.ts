/* eslint-disable unicorn/no-null -- Unknown stdout activity is explicit in the public observation. */
import {
	COLONY_OBSERVATION_PREFIX,
	COLONY_STDOUT_PREFIX,
	beads,
	latestColonyObservation,
	latestStdoutActivity,
	showBead,
} from "@hive/shared";
import type { RepositoryEndpoint, StdoutActivity } from "@hive/shared";
import type { LaunchReceipt } from "./launch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Inspect the current attempt's owned stdout artifact.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- File metadata preserves output time across sleep and daemon restart.
import { stat } from "node:fs/promises";

const STDOUT_PUBLICATION_INTERVAL_MS = 30_000;
const EMPTY = 0;

/** Native comments retain observation history and deduplicate unchanged facts across restarts. */
export async function publishObservation(
	repository: RepositoryEndpoint,
	id: string,
	fact: string,
): Promise<void> {
	const spawn = await showBead(repository, "colony", id);
	const latest = latestColonyObservation(spawn);
	const message = `${COLONY_OBSERVATION_PREFIX} ${fact}`;
	if (latest?.text !== message) {
		await beads(repository, "colony", ["comments", "add", id, "--message", message]);
	}
}

/** Awake reconciliation publishes metadata only; detached workers retain their existing authority. */
export async function publishStdoutActivity(
	repository: RepositoryEndpoint,
	receipt: Pick<LaunchReceipt, "id" | "attemptNumber" | "spawnId" | "directory">,
	final = false,
): Promise<void> {
	const spawn = await showBead(repository, "colony", receipt.spawnId);
	const activity: StdoutActivity = {
		attemptId: receipt.id,
		attemptNumber: receipt.attemptNumber,
		lastOutputAt: await readStdoutActivity(receipt.directory),
		recordedAt: new Date().toISOString(),
	};
	if (stdoutActivityDue(latestStdoutActivity(spawn), activity, final)) {
		await beads(repository, "colony", [
			"comments",
			"add",
			receipt.spawnId,
			"--message",
			`${COLONY_STDOUT_PREFIX} ${JSON.stringify(activity)}`,
		]);
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
