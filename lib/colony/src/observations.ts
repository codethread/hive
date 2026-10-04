import { COLONY_OBSERVATION_PREFIX, beads, latestColonyObservation, showBead } from "@hive/shared";
import type { RepositoryEndpoint } from "@hive/shared";

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
