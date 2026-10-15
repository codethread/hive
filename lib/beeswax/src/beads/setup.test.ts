import { expect, test } from "bun:test";
import { installAttentionQuery, setupBeads } from "./setup.ts";
import type { SetupServices } from "./setup.ts";
import { createMemoryBeads } from "@hive/beads";

const FIRST = 0;
const endpoint = { actor: "setup-test", cwd: "/repo", db: "/repo/tracker/.beads/beads.db" };

// eslint-disable-next-line max-statements -- Verify replacing only the owned preset against the memory service.
test("attention setup replaces its preset and preserves personal queries", async () => {
	const beads = createMemoryBeads();
	const failed = await beads.create(endpoint, {
		title: "Closed failure",
		labels: ["system", "bee", "bee-outcome:failed", "bee-resolution:unresolved"],
	});
	await beads.close(endpoint, failed.id);
	const pending = await beads.create(endpoint, { title: "Pending" });
	await beads.query.save(endpoint, "personal", { titleContains: "Pending" });
	await beads.query.save(endpoint, "bee-attention", { titleContains: "Pending" });
	const services = { actor: endpoint.actor, beads };
	await installAttentionQuery(endpoint.cwd, endpoint.db, services);
	await installAttentionQuery(endpoint.cwd, endpoint.db, services);
	expect(await beads.query.run(endpoint, "bee-attention")).toMatchObject({
		issues: [{ id: failed.id, status: "closed" }],
	});
	expect(await beads.query.run(endpoint, "personal")).toMatchObject({
		issues: [{ id: pending.id }],
	});
});

test("setup configures the adopted endpoint and installs attention using the injected service", async () => {
	const beads = createMemoryBeads();
	const writes = new Map<string, string>();
	const services: SetupServices = {
		actor: endpoint.actor,
		beads,
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
	expect(await beads.query.list(endpoint)).toMatchObject({ queries: [{ name: "bee-attention" }] });
});
