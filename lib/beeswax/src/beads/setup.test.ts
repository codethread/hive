import { expect, test } from "bun:test";
import type { SetupServices } from "./setup.ts";
import { setupBeads } from "./setup.ts";

const FIRST = 0;
const endpoint = { actor: "setup-test", cwd: "/repo", db: "/repo/tracker/.beads/beads.db" };

test("setup configures the adopted endpoint in the selected environment integrations", async () => {
	const writes = new Map<string, string>();
	const services: SetupServices = {
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
