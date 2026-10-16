import { BeeswaxError, errorMessage } from "../errors.ts";
import type { SetupIntegrations, SetupServices } from "./setup.ts";
import { defaultSetupIntegrations, localSetupServices, setupBeads } from "./setup.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Repository and tracker paths.
import { dirname, join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary Honeycomb configuration.
import { mkdtemp, rm } from "node:fs/promises";
import type { BeadsService } from "@hive/beads";
import type { Command } from "./environment.ts";
import { createNativeBeads } from "@hive/beads";
import { runCommand } from "./environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";
import { z } from "zod";

const commonDirectory = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"];
const trackerBranch = "tracker/state";
const upstream = "refs/remotes/origin/tracker/state";
const readySchema = z.object({
	kind: z.literal("ready"),
	ok: z.literal(true),
	worktree_path: z.string(),
});

export interface BootstrapServices extends SetupServices {
	/** Explicit attribution for tracker operations. */
	actor: string;
	/** Selected tracker service for native initialization and synchronization. */
	beads: BeadsService;
	/** Create a regular nested checkout through the installed Honeycomb CLI. */
	createTracker: (root: string, base?: string) => Promise<string>;
}

export const localBootstrapServices: BootstrapServices = {
	...localSetupServices,
	actor: process.env.BD_ACTOR ?? "sys-beeswax",
	beads: createNativeBeads({ execute: runCommand }),
	createTracker: createTrackerCheckout,
};

/** Materialize this clone's accepted tracker without publishing or replacing existing state. */
// eslint-disable-next-line max-statements -- One ordered bootstrap boundary keeps initialization and adoption together.
export async function bootstrapBeads(
	cwd: string,
	services: BootstrapServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
): Promise<string> {
	const common = await services.command(commonDirectory, cwd);
	const root = dirname(common);
	const tracker = join(root, ".worktrees", "tracker--state");
	const database = join(tracker, ".beads", "beads.db");
	const checkouts = [...new Set([root, tracker, cwd])];
	await verifySelection(root, database, services.command, integrations);
	if (cwd !== root) {
		await verifySelection(cwd, database, services.command, integrations);
	}
	const completed: string[] = [];
	try {
		await ensureTracker(root, tracker, services);
		completed.push("checkout");
		await verifyTracker(tracker, common, services.command);
		await importDatabase(tracker, database, services);
		completed.push("database_ready");
		/* eslint-disable no-await-in-loop -- Configure each checkout only after the shared endpoint is ready. */
		for (const checkout of checkouts) {
			await setupBeads(checkout, { database, kind: "database" }, services, integrations);
			completed.push(`environment:${checkout}`);
		}
		/* eslint-enable no-await-in-loop */
		return database;
	} catch (error) {
		throw await trackerFailure(error, { tracker, database, completed }, services);
	}
}

export interface InitializeOptions {
	/** Prefix for newly created issues. */
	prefix: string;
	/** Owner retained in the initialization receipt for subsequent task creation. */
	owner: string;
}

export interface InitializedTracker extends InitializeOptions {
	/** Selected database in the dedicated tracker checkout. */
	database: string;
	/** Actor used by native initialization. */
	actor: string;
}

/** Explicitly initialize a first tracker; never infer empty history from failed bootstrap. */
// Validate absence before creating the dedicated checkout and configuring it.
// eslint-disable-next-line max-statements, max-params -- Explicit selection, services and integrations.
export async function initializeBeads(
	cwd: string,
	options: InitializeOptions,
	services: BootstrapServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
): Promise<InitializedTracker> {
	const { common, root, tracker, database } = await preflightInitialization(
		cwd,
		services,
		integrations,
	);
	const completed: string[] = [];
	try {
		const created = await services.createTracker(root, "HEAD");
		completed.push("checkout");
		if (created !== tracker) {
			throw new Error(`Expected permanent tracker at ${tracker}; Honeycomb returned ${created}.`);
		}
		const actualCommon = await services.command(commonDirectory, tracker);
		const branch = await services.command(["git", "branch", "--show-current"], tracker);
		if (actualCommon !== common || branch !== trackerBranch) {
			throw new Error(`Expected ${tracker} to be this repository's tracker/state checkout.`);
		}
		await services.command(
			[
				"br",
				"--db",
				database,
				"--actor",
				services.actor,
				"init",
				"--prefix",
				options.prefix,
				"--json",
			],
			tracker,
		);
		completed.push("database_initialized");
		await services.beads.sync.flush({ actor: services.actor, cwd: tracker, db: database });
		completed.push("snapshot_flushed");
		/* eslint-disable no-await-in-loop -- Configure all checkouts only after native initialization. */
		for (const checkout of new Set([root, tracker, cwd])) {
			await setupBeads(checkout, { database, kind: "database" }, services, integrations);
			completed.push(`environment:${checkout}`);
		}
		/* eslint-enable no-await-in-loop */
		return { ...options, actor: services.actor, database };
	} catch (error) {
		throw await trackerFailure(error, { tracker, database, completed }, services);
	}
}

/** Refuse existing stores and inherited exports before setup creates local artifacts. */
// eslint-disable-next-line max-statements -- Read all initialization conflicts before any effects.
export async function preflightInitialization(
	cwd: string,
	services: BootstrapServices,
	integrations: SetupIntegrations = defaultSetupIntegrations,
) {
	const common = await services.command(commonDirectory, cwd);
	const root = dirname(common);
	const tracker = join(root, ".worktrees", "tracker--state");
	const database = join(tracker, ".beads", "beads.db");
	await verifySelection(root, database, services.command, integrations);
	if (cwd !== root) {
		await verifySelection(cwd, database, services.command, integrations);
	}
	const paths = [...new Set([root, cwd])].flatMap((checkout) =>
		["beads.db", "issues.jsonl"].map((name) => join(checkout, ".beads", name)),
	);
	const existing = await Promise.all(
		paths.map(async (path) => {
			if (await services.exists(path)) {
				return path;
			}
			return "";
		}),
	);
	const inherited = await services.command(
		["git", "ls-tree", "--name-only", "HEAD", "--", ".beads/issues.jsonl"],
		root,
	);
	if (existing.some(Boolean) || inherited !== "") {
		throw new BeeswaxError(
			"tracker_exists",
			"Existing in-place tracker or accepted export requires deliberate adoption; init will not replace it.",
			{
				context: {
					existing: existing.filter(Boolean),
					inheritedExport: inherited,
					nextCommand: "beeswax migrate setup",
				},
			},
		);
	}
	const local = await services.command(["git", "branch", "--list", trackerBranch], root);
	const remotes = await services.command(["git", "remote"], root);
	let remote = "";
	if (remotes.split("\n").includes("origin")) {
		remote = await services.command(
			["git", "ls-remote", "--heads", "origin", "refs/heads/tracker/state"],
			root,
		);
	}
	if (
		local !== "" ||
		remote !== "" ||
		(await services.exists(join(tracker, ".git"))) ||
		(await services.exists(database))
	) {
		throw new BeeswaxError(
			"tracker_exists",
			"Tracker history already exists. Bootstrap or adopt it instead of initializing.",
			{ context: { nextCommand: "beeswax setup --help", tracker } },
		);
	}
	return { common, root, tracker, database };
}

// --- Private functions ---

async function trackerFailure(
	cause: unknown,
	effects: { tracker: string; database: string; completed: string[] },
	services: SetupServices,
): Promise<BeeswaxError> {
	const [checkoutExists, databaseExists] = await Promise.all([
		services.exists(join(effects.tracker, ".git")),
		services.exists(effects.database),
	]);
	let database = "";
	if (databaseExists) {
		({ database } = effects);
	}
	return new BeeswaxError("tracker_setup_failed", errorMessage(cause), {
		context: {
			database,
			trackerEffects: { ...effects, checkoutExists, databaseExists },
			nextAction:
				"Inspect the retained tracker checkout, database and completed phases " +
				"before retrying; setup has not removed them.",
		},
	});
}

// eslint-disable-next-line max-params -- Match the public operation inputs at this selection boundary.
async function verifySelection(
	root: string,
	database: string,
	command: Command,
	integrations: SetupIntegrations,
): Promise<void> {
	if (integrations.environment === "none") {
		return;
	}
	const selected = z
		.object({ BEADS_DB: z.string().optional() })
		.parse(JSON.parse(await command(["mise", "env", "--json"], root)));
	if (selected.BEADS_DB !== undefined && selected.BEADS_DB !== database) {
		throw new Error(
			`Selected BEADS_DB at ${root} is ` +
				`${selected.BEADS_DB}, not ` +
				`${database}. Use beeswax beads setup to adopt an existing endpoint; bootstrap will not ` +
				"replace it.",
		);
	}
}

// eslint-disable-next-line max-statements -- Fetch, branch validation and creation are one non-destructive operation.
async function ensureTracker(
	root: string,
	tracker: string,
	services: BootstrapServices,
): Promise<void> {
	if (await services.exists(join(tracker, ".git"))) {
		return;
	}
	await services.command(
		["git", "fetch", "origin", `refs/heads/${trackerBranch}:${upstream}`],
		root,
	);
	const local = await services.command(
		["git", "branch", "--list", trackerBranch, "--format=%(objectname)"],
		root,
	);
	const accepted = await services.command(["git", "rev-parse", upstream], root);
	if (local !== "" && local !== accepted) {
		throw new Error(
			"Local tracker/state differs from origin/tracker/state. Review it before bootstrap; no branch was reset.",
		);
	}
	const created = await services.createTracker(root);
	if (created !== tracker) {
		throw new Error(`Expected permanent tracker at ${tracker}; Honeycomb returned ${created}.`);
	}
	await services.command(
		["git", "branch", "--set-upstream-to=origin/tracker/state", trackerBranch],
		tracker,
	);
}

async function verifyTracker(tracker: string, common: string, command: Command): Promise<void> {
	const actualCommon = await command(commonDirectory, tracker);
	const branch = await command(["git", "branch", "--show-current"], tracker);
	const remote = await command(
		["git", "rev-parse", "--symbolic-full-name", "@{upstream}"],
		tracker,
	);
	if (actualCommon !== common || branch !== trackerBranch || remote !== upstream) {
		throw new Error(
			`Expected ${tracker} to be this repository's tracker/state checkout tracking ` +
				"origin/tracker/state. Review its Git registration before bootstrap.",
		);
	}
}

async function importDatabase(
	tracker: string,
	database: string,
	services: BootstrapServices,
): Promise<void> {
	if (!(await services.exists(join(tracker, ".beads", "issues.jsonl")))) {
		throw new Error(
			`Missing tracker snapshot at ${tracker}` +
				"/.beads/issues.jsonl. Bootstrap requires existing history; do not " +
				"run br init.",
		);
	}
	const endpoint = { actor: services.actor, cwd: tracker, db: database };
	if (!(await services.exists(database))) {
		await services.beads.sync.import(endpoint);
		await services.beads.sync.flush(endpoint);
	}
	// Refuse incoming unreconciled JSONL before setup or install can trigger native auto-import.
	// Read-only verification must not auto-import or auto-export an existing database.
	const health = await services.beads.sync.status(endpoint);
	if (
		health.coverage_drift ||
		!health.jsonl_exists ||
		health.jsonl_newer ||
		health.workspace_health !== "healthy"
	) {
		throw new Error(
			`Tracker at ${tracker} is unhealthy or has unreconciled JSONL. Inspect br --db ` +
				`${database} sync --status --json and resolve the reported issues before bootstrap. ` +
				"Read publication guidance with beeswax skills file repository-setup references/publication.md.",
		);
	}
}

async function createTrackerCheckout(root: string, base = "origin/tracker/state"): Promise<string> {
	const configHome = await mkdtemp(join(tmpdir(), "hive-tracker-bootstrap-"));
	try {
		await Bun.write(join(configHome, "honeycomb.toml"), 'worktree_location = "nested"\n');
		const output = await runCommand(
			[
				"env",
				`XDG_CONFIG_HOME=${configHome}`,
				"honeycomb",
				"--cwd",
				root,
				"add",
				"--branch",
				trackerBranch,
				"--base",
				base,
				"--no-network",
				"--skip-command",
				"--json",
			],
			root,
		);
		return readySchema.parse(JSON.parse(output)).worktree_path;
	} finally {
		await rm(configHome, { force: true, recursive: true });
	}
}
