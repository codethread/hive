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

test("filesystem synchronization rejects visibly and missing records retain native diagnostics #test-409", async () => {
	const memory = createMemoryBeads();
	await expect(memory.sync.flush(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.sync.import(scope)).rejects.toBeInstanceOf(Error);
	await expect(
		memory.sync.merge(scope, { base: "base.jsonl", from: "incoming.jsonl" }),
	).rejects.toBeInstanceOf(Error);
	await expect(memory.sync.status(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.show(scope, "missing")).rejects.toBeInstanceOf(CommandError);
});

test("filesystem configuration rejects visibly rather than modelling native YAML", async () => {
	const memory = createMemoryBeads();
	await expect(memory.config.project(scope)).rejects.toBeInstanceOf(Error);
	await expect(memory.config.set(scope, "lock_timeout", "300000")).rejects.toBeInstanceOf(Error);
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

// eslint-disable-next-line max-statements -- A guarded close/reopen trace retains observations across mutations.
test("memory guarded closure and reopening preserve current work and reject stale revisions", async () => {
	const memory = createMemoryBeads();
	const created = await memory.create(scope, {
		title: "Visit",
		owner: "ct",
		assignee: "worker",
		acceptanceCriteria: "- [x] Verified",
	});
	await memory.update(scope, [created.id], { notes: "Authored notes" });
	const before = await memory.show(scope, created.id);
	const stale = await memory
		.close(scope, created.id, { ifUnchanged: created.updated_at })
		.catch((error: unknown) => error);
	expect(stale).toBeInstanceOf(CommandError);
	expect(stale).toMatchObject({ code: 6, nativeError: { code: "UPDATE_PRECONDITION_FAILED" } });
	expect(await memory.show(scope, created.id)).toEqual(before);
	await memory.close(scope, created.id, {
		ifUnchanged: before.updated_at,
		reason: "Readable closure",
	});
	const closed = await memory.show(scope, created.id);
	await expect(
		memory.close(scope, created.id, { ifUnchanged: before.updated_at }),
	).rejects.toMatchObject({ code: 6 });
	await expect(
		memory.update(scope, [created.id], { status: "open", ifUnchanged: before.updated_at }),
	).rejects.toBeInstanceOf(CommandError);
	await memory.update(scope, [created.id], { status: "open", ifUnchanged: closed.updated_at });
	const reopened = await memory.show(scope, created.id);
	expect(reopened).toMatchObject({
		status: "open",
		owner: "ct",
		assignee: "worker",
		notes: before.notes,
		acceptance_criteria: before.acceptance_criteria,
		acceptance_items: [{ index: 1, text: "Verified", checked: true }],
	});
	expect(reopened).not.toHaveProperty("closed_at");
	expect(reopened).not.toHaveProperty("close_reason");
});

test("memory hydrated checklist follows native bullets, markers and code-fence grammar", async () => {
	const memory = createMemoryBeads();
	const body = [
		"Plain prose",
		"- [ ] Required",
		" *[X]done  ",
		"+\t[\t] Tab marker",
		"-[/] Not a box",
		"````ts",
		"- [ ] Example",
		"```",
		"- [ ] Still an example",
		"```` trailing",
		"- [ ] Still fenced",
		"````",
		"- [x]After fence",
		"~~~",
		"- [x] Tilde example",
		"~~~\t",
		"- [ ]",
		"- [ ] Line\u2028separator",
	].join("\n");
	const issue = await memory.create(scope, { title: "Criteria", acceptanceCriteria: body });
	expect(issue).not.toHaveProperty("acceptance_items");
	const record = await memory.show(scope, issue.id);
	expect(record.acceptance_items).toEqual([
		{ index: 1, text: "Required", checked: false },
		{ index: 2, text: "done", checked: true },
		{ index: 3, text: "Tab marker", checked: false },
		{ index: 4, text: "After fence", checked: true },
		{ index: 5, text: "", checked: false },
		{ index: 6, text: "Line\u2028separator", checked: false },
	]);
	const many = await memory.showMany(scope, [issue.id]);
	const page = await memory.list(scope);
	expect(many[ZERO]!.acceptance_items).toEqual(record.acceptance_items);
	expect(page.issues[ZERO]).not.toHaveProperty("acceptance_items");
});

test("memory absent optional acceptance stays absent rather than inventing criteria", async () => {
	const memory = createMemoryBeads();
	const issue = await memory.create(scope, {
		title: "No checklist",
		acceptanceCriteria: "Free form criteria",
	});
	expect(await memory.show(scope, issue.id)).not.toHaveProperty("acceptance_items");
});
