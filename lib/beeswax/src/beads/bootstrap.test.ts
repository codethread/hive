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

function initializationFixture(acceptedHistory: boolean) {
	const calls: { argv: readonly string[]; cwd: string }[] = [];
	const checkouts: { root: string; base: string | undefined }[] = [];
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
					return Promise.resolve("{}");
				}
			}
		},
		createTracker: (checkoutRoot, base) => {
			checkouts.push({ root: checkoutRoot, base });
			return Promise.resolve(tracker);
		},
		exists: (path) => Promise.resolve(path === database),
		readConfig: () => {
			throw new Error("No environment integration requested");
		},
		write: () => {
			throw new Error("No environment integration requested");
		},
	};
	return { services, calls, checkouts };
}
