import type { Command, TrackerEnvironment } from "./environment.ts";
import {
	parseDatabase,
	renderMiseConfig,
	resolveEnvironment,
	runCommand,
	trackerRoot,
} from "./environment.ts";
import { BeeswaxError } from "../errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";

const EMPTY = 0;
const SINGLE = 1;
const DELIMITERS = 2;

export const localSetupServices: SetupServices = {
	command: runCommand,
	beadsDb: process.env.BEADS_DB,
	commandAvailable: (name, cwd) => Bun.which(name, { cwd }) !== null,
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
	/** Inherited assignment retained before invoking Mise in a different checkout. */
	beadsDb: string | undefined;
	/** Optional Mise availability for standalone checkout preparation. */
	commandAvailable: (name: string, cwd: string) => boolean;
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
}

export const defaultSetupIntegrations: SetupIntegrations = { environment: "mise" };

// eslint-disable-next-line max-statements, max-params -- Keep selected endpoint, services and integrations explicit.
export async function setupBeads(
	cwd: string,
	selection: Selection,
	services: SetupServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
): Promise<string> {
	const environment = await selectEnvironment(selection, services);
	await verifyDatabase(environment.BEADS_DB, services);
	if (integrations.environment === "mise") {
		await ensureLocalEnvironment(cwd, services);
		const path = join(cwd, "mise.local.toml");
		const contents = await services.readConfig(path);
		await services.write(path, renderMiseConfig(contents, environment));
		await services.command(["mise", "trust", path], cwd);
	}
	return environment.BEADS_DB;
}

// --- Private functions ---

async function selectEnvironment(
	selection: Selection,
	services: SetupServices,
): Promise<TrackerEnvironment> {
	if (selection.kind === "source") {
		const selected = await resolveEnvironment(selection.root, services.command, services.beadsDb);
		if (selected === undefined) {
			throw new BeeswaxError(
				"tracker_unselected",
				"No tracker selection was resolved. Configure BEADS_DB in Mise or supply --beads-db.",
			);
		}
		return selected;
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

// eslint-disable-next-line max-statements -- Validate local ownership before writing the endpoint.
async function ensureLocalEnvironment(cwd: string, services: SetupServices): Promise<void> {
	const tracked = await services.command(["git", "ls-files", "--", "mise.local.toml"], cwd);
	if (tracked !== "") {
		throw new BeeswaxError(
			"environment_tracked",
			`${cwd}/mise.local.toml is tracked; local database endpoints require an untracked file.`,
		);
	}
	const common = await services.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		cwd,
	);
	const path = join(common, "info/exclude");
	const current = await services.readConfig(path);
	const section =
		"# beeswax:begin mise-environment v1\n/mise.local.toml\n# beeswax:end mise-environment\n";
	const matches = [
		...current.matchAll(
			/^# beeswax:begin mise-environment[^\n]*\n[\s\S]*?^# beeswax:end mise-environment(?:\n|$)/gmu,
		),
	];
	const delimiters = current.match(/^# beeswax:(?:begin|end) mise-environment/gmu) ?? [];
	if (
		matches.length > SINGLE ||
		delimiters.length !== matches.length * DELIMITERS ||
		(matches.length === SINGLE && matches[EMPTY]![EMPTY] !== section)
	) {
		throw new BeeswaxError(
			"environment_ambiguous",
			`${path}: edited or ambiguous Mise environment ignore section.`,
		);
	}
	if (matches.length === EMPTY) {
		let separator = "";
		if (current !== "" && !current.endsWith("\n")) {
			separator = "\n";
		}
		await services.write(path, `${current}${separator}${section}`);
	}
}
