import type { Command, TrackerEnvironment } from "./environment.ts";
import {
	parseDatabase,
	renderCodexConfig,
	renderMiseConfig,
	resolveEnvironment,
	runCommand,
	trackerRoot,
} from "./environment.ts";
import type { BeadsService } from "@hive/beads";
import { BeeswaxError } from "../errors.ts";
import type { ProjectConfig } from "../config.ts";
import { createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";

export const localSetupServices: SetupServices = {
	actor: process.env.BD_ACTOR ?? "sys-beeswax",
	beads: createNativeBeads({ execute: runCommand }),
	command: runCommand,
	exists: (path) => Bun.file(path).exists(),
	readConfig: async (path) => {
		const file = Bun.file(path);
		if (await file.exists()) {
			return file.text();
		}
		return "";
	},
	write: async (path, contents) => {
		await Bun.write(path, contents);
	},
};

export type Selection =
	| {
			/** Adopt the explicitly selected tracker endpoint. */
			kind: "database";
			/** Existing absolute SQLite path in the permanent tracker checkout. */
			database: string;
	  }
	| {
			/** Inherit a configured checkout's environment. */
			kind: "source";
			/** Checkout containing the authoritative mise selection. */
			root: string;
	  };

export interface TrackerPolicy {
	/** Optional accepted native workspace policy; absence leaves native configuration alone. */
	beads: ProjectConfig["beads"];
	/** Explicit setup/update may replace a conflicting local value. */
	adopt: boolean;
}

export interface SetupServices {
	/** Attribution for explicit native configuration adoption. */
	actor: string;
	/** Selected native workspace configuration operations. */
	beads: Pick<BeadsService, "config">;
	/** Read existing local configuration, or an empty document when absent. */
	readConfig: (path: string) => Promise<string>;
	/** Check that adoption targets an existing runtime store. */
	exists: (path: string) => Promise<boolean>;
	/** Persist the generated local configuration. */
	write: (path: string, contents: string) => Promise<void>;
	/** Run environment resolution and Git inspection. */
	command: Command;
}

export interface SetupIntegrations {
	/** Write and trust mise environment configuration when selected. */
	environment: "mise" | "none";
	/** Write the Codex shell environment override when selected. */
	codex: boolean;
}

export const defaultSetupIntegrations: SetupIntegrations = { environment: "mise", codex: true };

// eslint-disable-next-line max-statements, max-params -- Keep selected endpoint, services and integrations explicit.
export async function setupBeads(
	cwd: string,
	selection: Selection,
	services: SetupServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
	policy?: TrackerPolicy,
): Promise<string> {
	const environment = await selectEnvironment(selection, services.command);
	await verifyDatabase(environment.BEADS_DB, services);
	await applyTrackerPolicy(environment.BEADS_DB, policy, services);
	if (integrations.environment === "mise") {
		const path = join(cwd, "mise.local.toml");
		const contents = await services.readConfig(path);
		await services.write(path, renderMiseConfig(contents, environment));
		await services.command(["mise", "trust", path], cwd);
	}
	if (integrations.codex) {
		const path = join(cwd, ".codex/config.toml");
		const contents = await services.readConfig(path);
		await services.write(path, renderCodexConfig(contents, environment));
	}
	return environment.BEADS_DB;
}

/** Apply accepted lock-wait policy to the selected tracker through native configuration. */
export async function applyTrackerPolicy(
	database: string,
	policy: TrackerPolicy | undefined,
	services: Pick<SetupServices, "beads" | "actor">,
): Promise<void> {
	if (policy?.beads === undefined) {
		return;
	}
	const scope = { db: database, cwd: trackerRoot(database), actor: services.actor };
	const current = await services.beads.config.project(scope);
	const expected = String(policy.beads.lock_timeout);
	if (current["lock_timeout"] === expected) {
		return;
	}
	if (current["lock_timeout"] !== undefined && !policy.adopt) {
		throw new BeeswaxError(
			"configuration_changed",
			"Native lock_timeout differs from accepted project policy. Run beeswax update to adopt the project value.",
			{
				context: {
					database,
					expected,
					actual: current["lock_timeout"],
					nextCommand: "beeswax update",
				},
			},
		);
	}
	await services.beads.config.set(scope, "lock_timeout", expected);
}

// --- Private functions ---

async function selectEnvironment(
	selection: Selection,
	command: Command,
): Promise<TrackerEnvironment> {
	if (selection.kind === "source") {
		return await resolveEnvironment(selection.root, command);
	}
	return { BEADS_DB: parseDatabase(selection.database) };
}

async function verifyDatabase(database: string, services: SetupServices): Promise<void> {
	if (!(await services.exists(database))) {
		throw new Error(
			`Tracker database does not exist: ${database}. Adopt or import it before setup.`,
		);
	}
	const tracker = trackerRoot(database);
	const branch = await services.command(["git", "branch", "--show-current"], tracker);
	if (branch !== "tracker/state") {
		throw new Error(`Expected tracker/state at ${tracker}; found ${branch}.`);
	}
}
