import { expect, test } from "bun:test";
import type { SetupServices } from "./setup.ts";
import { createMemoryBeads } from "@hive/beads";
import { setupBeads } from "./setup.ts";

const FIRST = 0;
const endpoint = { actor: "setup-test", cwd: "/repo", db: "/repo/tracker/.beads/beads.db" };

test("setup configures the adopted endpoint in the selected environment integrations #test-437", async () => {
	const writes = new Map<string, string>();
	const services: SetupServices = {
		actor: "setup-test",
		beads: createMemoryBeads(),
		command: (args) => {
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
	expect(writes.get("/repo/.codex/config.toml")).toContain(endpoint.db);
});

test("explicit setup adopts native policy while leaving absent policy untouched #test-654", async () => {
	const calls: string[] = [];
	let native: Record<string, string> = { lock_timeout: "1000", issue_prefix: "keep" };
	const services: SetupServices = {
		actor: "setup-test",
		beads: {
			config: {
				project: (scope) => {
					expect(scope.db).toBe(endpoint.db);
					calls.push("project");
					return Promise.resolve(native);
				},
				set: (_scope, key, value) => {
					calls.push("set");
					native = { ...native, [key]: value };
					return Promise.resolve();
				},
			},
		},
		command: () => Promise.resolve("tracker/state"),
		exists: () => Promise.resolve(true),
		readConfig: () => Promise.resolve(""),
		write: () => Promise.resolve(),
	};
	const integrations = { environment: "none", codex: false } as const;
	await setupBeads(
		endpoint.cwd,
		{ database: endpoint.db, kind: "database" },
		services,
		integrations,
	);
	expect(calls).toEqual([]);
	await setupBeads(
		endpoint.cwd,
		{ database: endpoint.db, kind: "database" },
		services,
		integrations,
		{ beads: { lock_timeout: 300_000 }, adopt: true },
	);
	expect(native).toEqual({ lock_timeout: "300000", issue_prefix: "keep" });
	expect(calls).toEqual(["project", "set"]);
});
