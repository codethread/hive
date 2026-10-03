/* eslint-disable no-duplicate-imports -- Repository rules require separate type-only imports. */
// eslint-disable-next-line no-duplicate-imports -- Keep type-only imports separate.
import type { Command, TrackerEnvironment } from "./beads-environment.ts";
import {
	parseDatabase,
	renderCodexConfig,
	renderMiseConfig,
	resolveEnvironment,
	runCommand,
	trackerRoot,
} from "./beads-environment.ts";
/* eslint-enable no-duplicate-imports */
// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Native CLI argument parsing.
import { parseArgs } from "node:util";
import { z } from "zod";

type Selection =
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

interface SetupServices {
	/** Read existing local configuration, or an empty document when absent. */
	readConfig: (path: string) => Promise<string>;
	/** Check that adoption targets an existing runtime store. */
	exists: (path: string) => Promise<boolean>;
	/** Persist the generated local configuration. */
	write: (path: string, contents: string) => Promise<void>;
	/** Run environment resolution and Git inspection. */
	command: Command;
}

const selectEnvironment = async (
	selection: Selection,
	command: Command,
): Promise<TrackerEnvironment> => {
	if (selection.kind === "source") {
		return await resolveEnvironment(selection.root, command);
	}
	return { BEADS_DB: parseDatabase(selection.database) };
};

const verifyDatabase = async (database: string, services: SetupServices): Promise<void> => {
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
};

const setupBeads = async (
	cwd: string,
	selection: Selection,
	services: SetupServices,
): Promise<string> => {
	const environment = await selectEnvironment(selection, services.command);
	await verifyDatabase(environment.BEADS_DB, services);
	const misePath = join(cwd, "mise.local.toml");
	const codexPath = join(cwd, ".codex/config.toml");
	const [mise, codex] = await Promise.all([
		services.readConfig(misePath),
		services.readConfig(codexPath),
	]);
	const configs = {
		codex: renderCodexConfig(codex, environment),
		mise: renderMiseConfig(mise, environment),
	};
	await services.write(misePath, configs.mise);
	await services.command(["mise", "trust", misePath], cwd);
	await services.write(codexPath, configs.codex);
	return environment.BEADS_DB;
};

const localSetupServices: SetupServices = {
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

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			db: { type: "string" },
			help: { short: "h", type: "boolean" },
			source: { type: "string" },
		},
	});
	if (values.help) {
		console.log("Usage: bun run beads:setup --db ABSOLUTE_DB | --source CONFIGURED_CHECKOUT");
	} else {
		if ((values.db === undefined) === (values.source === undefined)) {
			throw new Error("Select exactly one of --db or --source.");
		}
		const selectArguments = (): Selection => {
			if (values.db === undefined) {
				return { kind: "source", root: z.string().parse(values.source) };
			}
			return {
				database: values.db,
				kind: "database",
			};
		};
		const selection = selectArguments();
		const database = await setupBeads(process.cwd(), selection, localSetupServices);
		console.log(`Configured BEADS_DB=${database}. Restart existing agents to load the selection.`);
	}
}

export { localSetupServices, setupBeads, type SetupServices, type Selection };
