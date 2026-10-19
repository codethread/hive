import { expect, test } from "bun:test";
import type { SetupServices } from "./setup.ts";
import { setupBeads } from "./setup.ts";
import { setupBeadsAutomatically } from "./setup-auto.ts";

const FIRST = 0;
const SECOND = 1;
const endpoint = { actor: "setup-test", cwd: "/repo", db: "/repo/tracker/.beads/beads.db" };

test("setup configures the adopted endpoint in the selected environment integrations", async () => {
	const writes = new Map<string, string>();
	const services: SetupServices = {
		beadsDb: undefined,
		commandAvailable: () => true,
		command: (args) => {
			if (args.includes("ls-files")) {
				return Promise.resolve("");
			}
			if (args.includes("--git-common-dir")) {
				return Promise.resolve("/repo/.git");
			}
			if (args.at(FIRST) === "git") {
				return Promise.resolve("tracker/state");
			}
			return Promise.resolve("");
		},
		exists: () => Promise.resolve(true),
		readConfig: () => Promise.resolve(""),
		write: (path, contents) => {
			writes.set(path, contents);
			return Promise.resolve();
		},
	};
	expect(
		await setupBeads(endpoint.cwd, { database: endpoint.db, kind: "database" }, services),
	).toBe(endpoint.db);
	expect(writes.get("/repo/mise.local.toml")).toContain(endpoint.db);
});

test("direct setup refuses a tracked machine environment before writing local files", async () => {
	const writes = new Map<string, string>();
	const services: SetupServices = {
		beadsDb: undefined,
		commandAvailable: () => true,
		command: (argv) => {
			if (argv.includes("ls-files")) {
				return Promise.resolve("mise.local.toml");
			}
			return Promise.resolve("tracker/state");
		},
		exists: () => Promise.resolve(true),
		readConfig: () => Promise.resolve(""),
		write: (path, contents) => {
			writes.set(path, contents);
			return Promise.resolve();
		},
	};
	await expect(
		setupBeads("/repo", { kind: "database", database: endpoint.db }, services),
	).rejects.toMatchObject({ reason: "environment_tracked" });
	expect(writes.size).toBe(FIRST);
});

test.each([true, false])(
	"automatic checkout setup preserves assignment (Mise available=%s)",
	// eslint-disable-next-line max-statements -- Verify one preparation/repeat lifecycle per provider availability.
	async (miseAvailable) => {
		const writes = new Map<string, string>();
		const services: SetupServices = {
			beadsDb: endpoint.db,
			commandAvailable: () => miseAvailable,
			command: (argv) => {
				if (argv[FIRST] === "mise" && (!miseAvailable || argv[SECOND] === "env")) {
					throw new Error("Assignment must precede Mise");
				}
				if (argv.includes("--git-common-dir")) {
					return Promise.resolve("/other/.git");
				}
				if (argv.includes("--show-current")) {
					return Promise.resolve("tracker/state");
				}
				return Promise.resolve("");
			},
			exists: (path) => Promise.resolve(path === endpoint.db),
			readConfig: (path) => Promise.resolve(writes.get(path) ?? "# user setting\n"),
			write: (path, contents) => {
				writes.set(path, contents);
				return Promise.resolve();
			},
		};
		expect(await setupBeadsAutomatically("/other/worktree", "/other/source", services)).toBe(
			endpoint.db,
		);
		if (!miseAvailable) {
			expect(writes.size).toBe(FIRST);
			return;
		}
		const env = writes.get("/other/worktree/mise.local.toml");
		expect(env).toContain(endpoint.db);
		expect(env).toContain("# user setting");
		expect(writes.get("/other/.git/info/exclude")).toContain("/mise.local.toml");
		const first = new Map(writes);
		await setupBeadsAutomatically("/other/worktree", "/other/source", services);
		expect(writes).toEqual(first);
	},
);

test("prepare resolves Mise intent without requiring a particular local config filename", async () => {
	const writes = new Map<string, string>();
	const services: SetupServices = {
		beadsDb: undefined,
		commandAvailable: () => true,
		command: (argv, cwd) => {
			if (argv.includes("--json")) {
				if (cwd === "/source") {
					return Promise.resolve(JSON.stringify({ BEADS_DB: endpoint.db }));
				}
				return Promise.resolve("{}");
			}
			if (argv.includes("--git-common-dir")) {
				return Promise.resolve("/repo/.git");
			}
			if (argv.includes("--show-current")) {
				return Promise.resolve("tracker/state");
			}
			return Promise.resolve("");
		},
		exists: (path) => Promise.resolve(path === endpoint.db),
		readConfig: (path) => Promise.resolve(writes.get(path) ?? ""),
		write: (path, contents) => {
			writes.set(path, contents);
			return Promise.resolve();
		},
	};
	expect(await setupBeadsAutomatically("/repo/child", "/source", services)).toBe(endpoint.db);
	expect(writes.get("/repo/child/mise.local.toml")).toContain(endpoint.db);
});

test("checkout preparation retains its own Mise endpoint before inheriting a source", async () => {
	const writes = new Map<string, string>();
	const queries: string[] = [];
	const services: SetupServices = {
		beadsDb: undefined,
		commandAvailable: () => true,
		command: (argv, cwd) => {
			if (argv[FIRST] === "mise" && argv[SECOND] === "env") {
				queries.push(cwd);
				if (cwd === "/child") {
					return Promise.resolve(JSON.stringify({ BEADS_DB: endpoint.db }));
				}
				return Promise.resolve(JSON.stringify({ BEADS_DB: "/source/.beads/beads.db" }));
			}
			if (argv.includes("--git-common-dir")) {
				return Promise.resolve("/repo/.git");
			}
			if (argv.includes("--show-current")) {
				return Promise.resolve("tracker/state");
			}
			return Promise.resolve("");
		},
		exists: () => Promise.resolve(true),
		readConfig: (path) => Promise.resolve(writes.get(path) ?? ""),
		write: (path, contents) => {
			writes.set(path, contents);
			return Promise.resolve();
		},
	};
	expect(await setupBeadsAutomatically("/child", "/source", services)).toBe(endpoint.db);
	expect(queries).toEqual(["/child"]);
	expect(writes.get("/child/mise.local.toml")).toContain(endpoint.db);
});
