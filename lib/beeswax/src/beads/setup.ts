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
import { createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";

export const localSetupServices: SetupServices = {
	actor: process.env.BD_ACTOR ?? "hive-setup",
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

export interface SetupServices {
	/** Explicit attribution for tracker operations. */
	actor: string;
	/** Selected tracker service, independent of Git and filesystem operations. */
	beads: BeadsService;
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

// Checkout environment and native preset installation share one explicit setup boundary.
// eslint-disable-next-line max-statements, max-params -- Keep selected endpoint, services and integrations explicit.
export async function setupBeads(
	cwd: string,
	selection: Selection,
	services: SetupServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
): Promise<string> {
	const environment = await selectEnvironment(selection, services.command);
	await verifyDatabase(environment.BEADS_DB, services);
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
	await installAttentionQuery(cwd, environment.BEADS_DB, services);
	return environment.BEADS_DB;
}

/** Native list filters are stored by br in the selected tracker, without a Hive query engine. */
export async function installAttentionQuery(
	cwd: string,
	database: string,
	services: Pick<SetupServices, "beads" | "actor">,
): Promise<void> {
	const endpoint = { actor: services.actor, cwd, db: database };
	const { queries } = await services.beads.query.list(endpoint);
	if (queries.some(({ name }) => name === "bee-attention")) {
		await services.beads.query.delete(endpoint, "bee-attention");
	}
	await services.beads.query.save(
		endpoint,
		"bee-attention",
		{
			all: true,
			labels: ["system", "bee", "bee-outcome:failed", "bee-resolution:unresolved"],
			limit: 0,
		},
		"Failed unresolved spawn requests, including closed requests",
	);
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
