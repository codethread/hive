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

/** Preserve confirmed preset effects when a native query operation fails. */
export class BeeSetupError extends Error {
	readonly context: {
		/** Selected repository and tracker. */
		repository: RepositoryEndpoint;
		/** Confirmed removal of a previous preset during refresh. */
		presetRemoved: boolean;
		/** Confirmed successful preset save. */
		presetInstalled: boolean;
	};
	constructor(error: unknown, context: BeeSetupError["context"]) {
		let message = String(error);
		if (error instanceof Error) {
			({ message } = error);
		}
		super(message);
		this.name = "BeeSetupError";
		this.context = context;
	}
}

/** Refresh only Bee's attention preset in the selected tracker, preserving other saved queries. */
// eslint-disable-next-line max-statements -- Keep ordered setup effects and their receipt together.
export async function setupBee(
	options: BeeSetupOptions,
	{ beads, resolveRepository }: TrackerCommands,
): Promise<BeeSetupResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const actor = z.string().min(NONEMPTY).parse(options.actor);
	const endpoint = { ...trackerScope(repository, actor), noAutoImport: true, noAutoFlush: true };
	const effects = {
		repository,
		presetRemoved: false,
		presetInstalled: false,
	};
	try {
		const { queries } = await beads.query.list(endpoint);
		if (queries.some(({ name }) => name === PRESET)) {
			await beads.query.delete(endpoint, PRESET);
			effects.presetRemoved = true;
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
		effects.presetInstalled = true;
		return { kind: "bee_setup", repository, preset: PRESET };
	} catch (error) {
		throw new BeeSetupError(error, effects);
	}
}
