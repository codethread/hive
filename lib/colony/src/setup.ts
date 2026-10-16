import type { InspectionOptions } from "./bee-cli.ts";
import type { RepositoryEndpoint } from "@hive/shared";
import type { TrackerCommands } from "./tracker.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Viewer policy belongs in each selected checkout.
import { join } from "node:path";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const NONEMPTY = 1;
const PRESET = "bee-attention";
const recipes = {
	work: {
		description: "Ordinary work, excluding automation beads",
		filters: { exclude_tags: ["system"] },
	},
	system: { description: "Automation-owned records", filters: { tags: ["system"] } },
};
const recipeDocument = z.looseObject({ recipes: z.record(z.string(), z.unknown()).default({}) });
const systemTag = z.tuple([z.literal("system")]);
const expectedRecipes = {
	work: z
		.object({
			description: z.string().optional(),
			filters: z.object({ exclude_tags: systemTag }).strict(),
		})
		.strict(),
	system: z
		.object({
			description: z.string().optional(),
			filters: z.object({ tags: systemTag }).strict(),
		})
		.strict(),
};

export interface BeeSetupFiles {
	/** Validate and return caller and permanent tracker checkouts. */
	checkouts: (caller: string, database: string) => Promise<string[]>;
	/** Read optional checkout-local viewer configuration; absent files return empty text. */
	read: (path: string) => Promise<string>;
	/** Write reconciled viewer configuration, creating its parent directory. */
	write: (path: string, contents: string) => Promise<void>;
}

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
	/** Checkout-local viewer recipes confirmed after setup. */
	recipes: string[];
}

/** Preserve confirmed setup effects when a later query or file operation fails. */
export class BeeSetupError extends Error {
	readonly context: {
		/** Selected repository and tracker. */
		repository: RepositoryEndpoint;
		/** Confirmed removal of a previous preset during refresh. */
		presetRemoved: boolean;
		/** Confirmed successful preset save. */
		presetInstalled: boolean;
		/** Viewer files confirmed before failure. */
		recipesInstalled: string[];
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

/** Install Bee's attention query and BV views without a daemon or kind configuration. */
// eslint-disable-next-line max-statements -- Keep ordered setup effects and their receipt together.
export async function setupBee(
	options: BeeSetupOptions,
	{ beads, resolveRepository, setupFiles }: TrackerCommands & { setupFiles: BeeSetupFiles },
): Promise<BeeSetupResult> {
	const repository = await resolveRepository(options.repo, options.beadsDb);
	const actor = z.string().min(NONEMPTY).parse(options.actor);
	const endpoint = { ...trackerScope(repository, actor), noAutoImport: true, noAutoFlush: true };
	const effects = {
		repository,
		presetRemoved: false,
		presetInstalled: false,
		recipesInstalled: [] as string[],
	};
	try {
		const checkouts = await setupFiles.checkouts(options.repo, repository.beadsDb);
		const plans = await Promise.all(
			[...new Set(checkouts)].map(async (checkout) => {
				const path = join(checkout, ".bv/recipes.yaml");
				const original = await setupFiles.read(path);
				return { path, original, contents: reconcileRecipes(original, path) };
			}),
		);
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
		/* eslint-disable no-await-in-loop -- Retain each confirmed file before attempting the next. */
		for (const plan of plans) {
			if (plan.contents !== plan.original) {
				await setupFiles.write(plan.path, plan.contents);
			}
			effects.recipesInstalled.push(plan.path);
		}
		/* eslint-enable no-await-in-loop */
		return { kind: "bee_setup", repository, preset: PRESET, recipes: effects.recipesInstalled };
	} catch (error) {
		throw new BeeSetupError(error, effects);
	}
}

// --- Private functions ---

// eslint-disable-next-line max-statements -- Preserve unrelated config while validating the two owned recipe names.
function reconcileRecipes(contents: string, path: string): string {
	let input: unknown = {};
	if (contents !== "") {
		input = Bun.YAML.parse(contents);
	}
	const document = recipeDocument.parse(input);
	let changed = false;
	for (const name of ["work", "system"] as const) {
		const current = document.recipes[name];
		if (current === undefined) {
			document.recipes[name] = recipes[name];
			changed = true;
		} else if (!expectedRecipes[name].safeParse(current).success) {
			throw new Error(
				`Conflicting BV recipe ${name} in ${path}. ` +
					"Reconcile it with Bee's system-label policy before rerunning bee setup.",
			);
		}
	}
	if (changed) {
		return `${Bun.YAML.stringify(document)}\n`;
	}
	return contents;
}
