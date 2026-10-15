import type { InspectionOptions } from "./bee-cli.ts";
import type { RepositoryEndpoint } from "@hive/shared";
import type { TrackerCommands } from "./tracker.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const NONEMPTY = 1;
const PRESET = "bee-attention";

export interface BeeSetupOptions extends InspectionOptions {
	/** Explicit attribution for saved-query changes. */
	actor: string;
}

export interface BeeSetupResult {
	/** Confirmed setup operation. */
	kind: "bee_setup";
	/** Selected tracker receiving the preset. */
	repository: RepositoryEndpoint;
	/** Native saved query installed or refreshed. */
	preset: typeof PRESET;
}

/** Install Bee's failure-attention filter without requiring a daemon or kind configuration. */
export async function setupBee(
	options: BeeSetupOptions,
	{ beads, resolveRepository }: TrackerCommands,
): Promise<BeeSetupResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const actor = z.string().min(NONEMPTY).parse(options.actor);
	const endpoint = trackerScope(repository, actor);
	const { queries } = await beads.query.list(endpoint);
	if (queries.some(({ name }) => name === PRESET)) {
		await beads.query.delete(endpoint, PRESET);
	}
	await beads.query.save(
		endpoint,
		PRESET,
		{
			all: true,
			labels: ["system", "bee", "bee-outcome:failed", "bee-resolution:unresolved"],
			limit: 0,
		},
		"Failed unresolved spawn requests, including closed requests",
	);
	return { kind: "bee_setup", repository, preset: PRESET };
}
