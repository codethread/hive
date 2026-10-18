import type { AlertStore } from "./alerts.ts";
import type { Command } from "./environment.ts";
import { alertDatabase } from "./alerts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Derive the conventional tracker endpoint without native Beads.
import { resolve } from "node:path";
import { z } from "zod";

const selectionSchema = z.compile(z.looseObject({ BEADS_DB: z.string().optional() }));

export interface AlertSelectionServices {
	/** Inherited endpoint, retained independently of repository discovery. */
	beadsDb: string | undefined;
	/** Read repository/configured environment facts; never invoke native Beads. */
	command: Command;
	/** Observe an independent receipt when discovering the conventional endpoint. */
	observe: AlertStore["observe"];
	/** Locate a conventional existing tracker when no endpoint was supplied. */
	exists: (path: string) => Promise<boolean>;
	/** Mise is optional, including for environment:none installations. */
	commandAvailable: (name: string, cwd: string) => boolean;
}

/** All alert observation and publication operations select the same endpoint. */
// eslint-disable-next-line max-statements -- Keep selection precedence visible at its single boundary.
export async function selectAlertDatabase(
	repo: string,
	database: string | undefined,
	services: AlertSelectionServices,
): Promise<string | undefined> {
	const supplied = database ?? services.beadsDb;
	if (supplied !== undefined) {
		return alertDatabase(supplied);
	}
	const conventional = await conventionalDatabase(repo, services);
	if (conventional !== undefined && (await services.exists(conventional))) {
		return alertDatabase(conventional);
	}
	if (services.commandAvailable("mise", repo)) {
		const output = await services.command(["mise", "env", "--json"], repo);
		const selection = selectionSchema.parse(JSON.parse(output));
		if (selection.BEADS_DB !== undefined) {
			return alertDatabase(selection.BEADS_DB);
		}
	}
	if (conventional === undefined) {
		return;
	}
	const observation = await services.observe(conventional);
	if (observation.alert === null) {
		return;
	}
	return alertDatabase(conventional);
}

// --- Private functions ---

async function conventionalDatabase(
	repo: string,
	services: AlertSelectionServices,
): Promise<string | undefined> {
	if (!services.commandAvailable("git", repo)) {
		return;
	}
	const common = await services.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		repo,
	);
	return resolve(common, "../.worktrees/tracker--state/.beads/beads.db");
}
