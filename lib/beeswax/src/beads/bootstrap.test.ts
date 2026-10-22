import { expect, test } from "bun:test";
import type { BootstrapServices } from "./bootstrap.ts";
import { createMemoryBeads } from "@hive/beads";
import { initializeBeads } from "./bootstrap.ts";

const first = 0;
const root = "/repo";
const tracker = "/repo/.worktrees/tracker--state";
const database = `${tracker}/.beads/beads.db`;
const integrations = { environment: "none", codex: false } as const;
const options = { prefix: "fresh", owner: "project-owner" };

test("initialization retains attribution and configures only the dedicated tracker #test-336", async () => {
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

test.each(["issues.jsonl", "inherited-export"])(
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

test("initialization adopts policy after init and before the first snapshot flush #test-655", async () => {
	const { services, calls } = initializationFixture(false);
	const phases: string[] = [];
	const { command } = services;
	services.command = (argv, cwd) => {
		if (argv.includes("init")) {
			phases.push("init");
		}
		return command(argv, cwd);
	};
	services.beads.config = {
		project: () => Promise.resolve({}),
		set: (scope, key, value) => {
			expect(scope.db).toBe(database);
			expect({ key, value }).toEqual({ key: "lock_timeout", value: "300000" });
			phases.push("policy");
			return Promise.resolve();
		},
	};
	services.beads.sync.flush = () => {
		phases.push("flush");
		return Promise.resolve();
	};
	await initializeBeads(root, options, services, integrations, {
		beads: { lock_timeout: 300_000 },
		adopt: true,
	});
	expect(phases).toEqual(["init", "policy", "flush"]);
	expect(calls.some(({ argv }) => argv.includes("--lock-timeout"))).toBe(false);
});

function initializationFixture(acceptedHistory: boolean) {
	const calls: { argv: readonly string[]; cwd: string }[] = [];
	const checkouts: { root: string; base: string | undefined }[] = [];
	let initialized = false;
	const beads = createMemoryBeads();
	const services: BootstrapServices = {
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
