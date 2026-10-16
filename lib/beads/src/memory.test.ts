import { expect, test } from "bun:test";
import { CommandError } from "./model.ts";
import { createMemoryBeads } from "./memory.ts";

const ONE = 1;
const ZERO = 0;
const scope = { cwd: "/fixture", db: "/fixture/beads.db", actor: "worker" };
const calendarNow = new Date("2026-01-15T12:00:00").toISOString();

test("memory stores are isolated by factory and database", async () => {
	const first = createMemoryBeads();
	const second = createMemoryBeads();
	await first.create(scope, { title: "one", owner: "ct" });
	const firstPage = await first.list(scope);
	expect(firstPage.issues).toHaveLength(ONE);
	const secondPage = await second.list(scope);
	expect(secondPage.issues).toHaveLength(ZERO);
	const otherPage = await first.list({ ...scope, db: "/other/beads.db" });
	expect(otherPage.issues).toHaveLength(ZERO);
});

test.each([
	{ factory: {}, operationActor: undefined, expected: "sys-memory" },
	{ factory: { actor: "fixture" }, operationActor: undefined, expected: "fixture" },
	{ factory: { actor: "fixture" }, operationActor: "worker", expected: "worker" },
])("actor selection credits $expected", async ({ factory, operationActor, expected }) => {
	const memory = createMemoryBeads({ db: "/selected/beads.db", ...factory });
	const endpoint = { cwd: "/execution", actor: operationActor };
	const location = await memory.where(endpoint);
	expect(location.database_path).toBe("/selected/beads.db");
	const created = await memory.create(endpoint, { title: "fixture" });
	expect(created.created_by).toBe(expected);
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

// One injected clock proves time-gate maturity and monotonic revisions through clock reversal.
// eslint-disable-next-line max-statements
test("deferral follows the fixture clock without requiring another mutation", async () => {
	let now = "2026-01-01T00:00:00.000Z";
	const memory = createMemoryBeads({ now: () => now });
	const issue = await memory.create(scope, {
		title: "later",
		defer: "2026-01-01T00:00:01Z",
		due: "2026-01-01T00:00:02Z",
	});
	expect(await memory.ready(scope)).toEqual([]);
	now = "2026-01-01T00:00:01.000Z";
	const ready = await memory.ready(scope);
	expect(ready.map((bead) => bead.id)).toEqual([issue.id]);
	await memory.update(scope, [issue.id], { claim: true });
	const claimed = await memory.show(scope, issue.id);
	expect(claimed.status).toBe("in_progress");
	expect(claimed.due_at).toBe(issue.due_at!);
	now = "2025-01-01T00:00:00.000Z";
	await memory.update(scope, [issue.id], { title: "clock moved back" });
	const after = await memory.show(scope, issue.id);
	expect(after.updated_at > claimed.updated_at).toBe(true);
});

test.each([
	{ input: "today", expected: "2026-01-15T17:00:00" },
	{ input: "yesterday", expected: "2026-01-14T09:00:00" },
	{ input: "tomorrow", expected: "2026-01-16T09:00:00" },
	{ input: "next-week", expected: "2026-01-22T09:00:00" },
	{ input: "nextweek", expected: "2026-01-22T09:00:00" },
])("calendar due date $input uses the injected local calendar", async ({ input, expected }) => {
	const memory = createMemoryBeads({ now: () => calendarNow });
	const issue = await memory.create(scope, { title: "calendar", due: input });
	expect(Date.parse(issue.due_at!)).toBe(new Date(expected).getTime());
});
