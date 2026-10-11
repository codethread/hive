import { expect, test } from "bun:test";
import { CommandError } from "./model.ts";
import { createMemoryBeads } from "./memory.ts";

const ONE = 1;
const ZERO = 0;
const scope = { cwd: "/fixture", db: "/fixture/beads.db", actor: "worker" };

test("memory stores are isolated by factory and database", async () => {
	const first = createMemoryBeads();
	const second = createMemoryBeads();
	const created = await first.create(scope, { title: "one", owner: "ct" });
	expect(created.id).toBe("mem-1");
	const firstPage = await first.list(scope);
	expect(firstPage.issues).toHaveLength(ONE);
	const secondPage = await second.list(scope);
	expect(secondPage.issues).toHaveLength(ZERO);
	const otherPage = await first.list({ ...scope, db: "/other/beads.db" });
	expect(otherPage.issues).toHaveLength(ZERO);
});

test("fixture discovery and actor selection do not require native I/O", async () => {
	const memory = createMemoryBeads({ db: "/selected/beads.db", actor: "fixture" });
	const location = await memory.where({ cwd: "/execution" });
	expect(location.database_path).toBe("/selected/beads.db");
	const created = await memory.create({ cwd: "/execution" }, { title: "fixture" });
	expect(created.created_by).toBe("fixture");
});

test("filesystem synchronization rejects visibly and missing records retain native diagnostics", async () => {
	const memory = createMemoryBeads();
	await expect(memory.sync.flush(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.sync.import(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.sync.merge(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.sync.status(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.show(scope, "missing")).rejects.toBeInstanceOf(CommandError);
});

test("typed records and saved filters are detached from mutable fixture storage", async () => {
	const memory = createMemoryBeads();
	const created = await memory.create(scope, { title: "one", labels: ["team"] });
	created.labels.push("outside");
	const selection = { labels: ["team"] };
	await memory.query.save(scope, "team", selection);
	selection.labels.push("outside");
	const after = await memory.show(scope, created.id);
	expect(after.labels).toEqual(["team"]);
	const matches = await memory.query.run(scope, "team");
	expect(matches.issues).toHaveLength(ONE);
});
