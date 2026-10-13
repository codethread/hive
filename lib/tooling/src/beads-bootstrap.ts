// eslint-disable-next-line import/no-nodejs-modules -- Repository and tracker paths.
import { dirname, join } from "node:path";
import { localSetupServices, setupBeads } from "./beads-setup.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Bootstrap owns a temporary Honeycomb configuration.
import { mkdtemp, rm } from "node:fs/promises";
import { resolveEnvironment, runCommand } from "./beads-environment.ts";
// eslint-disable-next-line no-duplicate-imports -- Keep type-only imports separate.
import type { Command } from "./beads-environment.ts";
// eslint-disable-next-line no-duplicate-imports -- Keep type-only imports separate.
import type { SetupServices } from "./beads-setup.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native CLI argument parsing.
import { parseArgs } from "node:util";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary config stays outside the repository.
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
	/** Create a regular nested checkout through the repository-owned Honeycomb CLI. */
	createTracker: (root: string) => Promise<string>;
}

export const localBootstrapServices: BootstrapServices = {
	...localSetupServices,
	createTracker: createTrackerCheckout,
};

/** Materialize this clone's accepted tracker without publishing or replacing existing state. */
// eslint-disable-next-line max-statements -- One ordered bootstrap boundary keeps initialization and adoption together.
export async function bootstrapBeads(cwd: string, services: BootstrapServices): Promise<string> {
	const common = await services.command(commonDirectory, cwd);
	const root = dirname(common);
	const tracker = join(root, ".worktrees", "tracker--state");
	const database = join(tracker, ".beads", "beads.db");
	const checkouts = [...new Set([root, tracker, cwd])];
	await verifySelection(root, database, services.command);
	if (cwd !== root) {
		await verifySelection(cwd, database, services.command);
	}
	await ensureTracker(root, tracker, services);
	await verifyTracker(tracker, common, services.command);
	await importDatabase(tracker, database, services);
	// The permanent full checkout owns the merge driver and Git quality hooks.
	await services.command(["bun", "install", "--frozen-lockfile"], tracker);
	/* eslint-disable no-await-in-loop -- Configure each checkout only after the shared endpoint is ready. */
	for (const checkout of checkouts) {
		await setupBeads(checkout, { database, kind: "database" }, services);
	}
	/* eslint-enable no-await-in-loop */
	return database;
}

// --- Private functions ---

async function verifySelection(root: string, database: string, command: Command): Promise<void> {
	const selected = await resolveEnvironment(root, command);
	if (selected.BEADS_DB !== database) {
		throw new Error(
			`Selected BEADS_DB at ${root} is ` +
				`${selected.BEADS_DB}, not ` +
				`${database}. Use beads:setup to adopt an existing endpoint; bootstrap will not ` +
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
				`${database} sync --status --json and follow docs/beads-integration.md recovery ` +
				"before bootstrap.",
		);
	}
}

async function createTrackerCheckout(root: string): Promise<string> {
	const configHome = await mkdtemp(join(tmpdir(), "hive-tracker-bootstrap-"));
	try {
		await Bun.write(join(configHome, "honeycomb.toml"), 'worktree_location = "nested"\n');
		const output = await runCommand(
			[
				"env",
				`XDG_CONFIG_HOME=${configHome}`,
				"bun",
				join(import.meta.dir, "../../honeycomb/bin/honeycomb.ts"),
				"--cwd",
				root,
				"add",
				"--branch",
				trackerBranch,
				"--base",
				"origin/tracker/state",
				"--json",
			],
			root,
		);
		return readySchema.parse(JSON.parse(output)).worktree_path;
	} finally {
		await rm(configHome, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	const { values } = parseArgs({ options: { help: { short: "h", type: "boolean" } } });
	if (values.help) {
		console.log(
			"Usage: bun run beads:bootstrap\nCreate this clone's permanent tracker " +
				"from origin/tracker/state; never commits or pushes.",
		);
	} else {
		const database = await bootstrapBeads(process.cwd(), localBootstrapServices);
		console.log(`Beads ready: ${database}. Restart existing agents to load the selection.`);
	}
}
