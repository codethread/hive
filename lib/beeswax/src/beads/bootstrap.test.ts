import { bootstrapBeads, initializeBeads, selectSetupServices } from "./bootstrap.ts";
import { expect, test } from "bun:test";
import type { BootstrapServices } from "./bootstrap.ts";
import type { SetupFlags } from "../setup.ts";
import { createMemoryBeads } from "@hive/beads";
import { fixture } from "../../tests/support.ts";
import { resolveSetup } from "../setup.ts";

const first = 0;
const root = "/repo";
const tracker = "/repo/.worktrees/tracker--state";
const database = `${tracker}/.beads/beads.db`;
const integrations = { environment: "none" } as const;
const options = { prefix: "fresh", owner: "project-owner" };

test("initialization retains attribution and configures only the dedicated tracker", async () => {
	const { services, calls, checkouts } = initializationFixture(false);
	expect(await initializeBeads(root, options, services, integrations)).toEqual({
		...options,
		actor: "fixture-actor",
		database,
	});
	expect(checkouts).toEqual([{ root, base: "HEAD" }]);
	expect(calls).toContainEqual({
		argv: [
			"br",
			"--db",
			database,
			"--actor",
			"fixture-actor",
			"init",
			"--prefix",
			"fresh",
			"--json",
		],
		cwd: tracker,
	});
});

test("initialization refuses existing accepted history before creating a checkout", async () => {
	const { services, checkouts } = initializationFixture(true);
	await expect(initializeBeads(root, options, services, integrations)).rejects.toBeInstanceOf(
		Error,
	);
	expect(checkouts).toEqual([]);
});

test.each(["beads.db", "issues.jsonl", "inherited-export"])(
	"initialization refuses %s before creating artifacts",
	async (existing) => {
		const { services, checkouts, calls } = initializationFixture(false);
		const { command } = services;
		services.command = (argv, cwd) => {
			if (existing === "inherited-export" && argv.includes("ls-tree")) {
				return Promise.resolve(".beads/issues.jsonl");
			}
			return command(argv, cwd);
		};
		services.exists = (path) => Promise.resolve(path === `/repo/.beads/${existing}`);
		await expect(initializeBeads(root, options, services, integrations)).rejects.toMatchObject({
			reason: "tracker_exists",
		});
		expect(checkouts).toEqual([]);
		expect(calls.some(({ argv }) => argv[first] === "br")).toBe(false);
	},
);

test("initialization retains a created tracker and database when snapshot flush fails", async () => {
	const { services } = initializationFixture(false);
	services.beads.sync.flush = () => Promise.reject(new Error("inherited snapshot"));
	await expect(initializeBeads(root, options, services, integrations)).rejects.toMatchObject({
		reason: "tracker_setup_failed",
		context: {
			database,
			trackerEffects: {
				tracker,
				databaseExists: true,
				checkoutExists: true,
				completed: ["checkout", "database_initialized"],
			},
		},
	});
});

function initializationFixture(acceptedHistory: boolean) {
	const calls: { argv: readonly string[]; cwd: string }[] = [];
	const checkouts: { root: string; base: string | undefined }[] = [];
	let initialized = false;
	const beads = createMemoryBeads();
	const services: BootstrapServices = {
		beadsDb: undefined,
		commandAvailable: () => true,
		actor: "fixture-actor",
		beads: { ...beads, sync: { ...beads.sync, flush: () => Promise.resolve() } },
		// eslint-disable-next-line max-statements -- One deterministic command fixture models initialization observations.
		command: (argv, cwd) => {
			calls.push({ argv, cwd });
			switch (argv.join(" ")) {
				case "git rev-parse --path-format=absolute --git-common-dir": {
					return Promise.resolve("/repo/.git");
				}
				case "git ls-tree --name-only HEAD -- .beads/issues.jsonl":
				case "git branch --list tracker/state": {
					return Promise.resolve("");
				}
				case "git remote": {
					if (acceptedHistory) {
						return Promise.resolve("origin");
					}
					return Promise.resolve("");
				}
				case "git ls-remote --heads origin refs/heads/tracker/state": {
					return Promise.resolve("accepted-revision refs/heads/tracker/state");
				}
				case "git branch --show-current": {
					return Promise.resolve("tracker/state");
				}
				default: {
					if (argv[first] !== "br") {
						throw new Error(`Unexpected command: ${argv.join(" ")}`);
					}
					initialized = true;
					return Promise.resolve("{}");
				}
			}
		},
		createTracker: (checkoutRoot, base) => {
			checkouts.push({ root: checkoutRoot, base });
			return Promise.resolve(tracker);
		},
		exists: (path) =>
			Promise.resolve(initialized && (path === database || path === `${tracker}/.git`)),
		readConfig: () => {
			throw new Error("No environment integration requested");
		},
		write: () => {
			throw new Error("No environment integration requested");
		},
	};
	return { services, calls, checkouts };
}

test("initialization cannot replace a foreign explicit assignment even without Mise integration", async () => {
	const fx = initializationFixture(false);
	fx.services.beadsDb = "/assigned/.beads/beads.db";
	await expect(initializeBeads(root, options, fx.services, integrations)).rejects.toBeInstanceOf(
		Error,
	);
	expect(fx.checkouts).toEqual([]);
	expect(fx.calls.some(({ argv }) => argv[first] === "br")).toBe(false);
});

test.each([
	{
		name: "explicit custom",
		inherited: undefined,
		explicit: "/custom/.beads/beads.db",
		configured: undefined,
		refuses: true,
	},
	{
		name: "Mise custom",
		inherited: undefined,
		explicit: undefined,
		configured: "/custom/.beads/beads.db",
		refuses: true,
	},
	{
		name: "explicit over inherited",
		inherited: "/foreign/.beads/beads.db",
		explicit: database,
		configured: undefined,
		refuses: false,
	},
])(
	"resolved $name authority reaches tracker preflight without Mise writes",
	// eslint-disable-next-line max-statements -- Verify the endpoint handoff and effects in one existing fixture.
	async ({ inherited, explicit, configured, refuses }) => {
		const fx = initializationFixture(false);
		const workspace = fixture();
		workspace.deps.context.beadsDb = inherited ?? "";
		workspace.deps.selectDatabase = () => Promise.resolve(configured);
		fx.services.beadsDb = inherited;
		const flags: SetupFlags = { tracker: "init", environment: "none", yes: true };
		if (explicit !== undefined) {
			flags.beadsDb = explicit;
		}
		const selected = await resolveSetup(flags, true, workspace.deps);
		const services = selectSetupServices(fx.services, selected);
		const initialize = initializeBeads(root, options, services, {
			environment: selected.environment,
		});
		if (refuses) {
			await expect(initialize).rejects.toBeInstanceOf(Error);
			await expect(
				bootstrapBeads(root, services, { environment: selected.environment }),
			).rejects.toBeInstanceOf(Error);
			expect(fx.checkouts).toEqual([]);
			expect(fx.calls.some(({ argv }) => argv[first] === "br")).toBe(false);
			return;
		}
		const initialized = await initialize;
		expect(initialized.database).toBe(database);
		expect(fx.checkouts).toEqual([{ root, base: "HEAD" }]);
	},
);
