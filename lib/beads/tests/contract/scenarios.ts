/* eslint-disable max-statements -- Bounded differential traces keep observations beside their mutations. */
import type {
	BeadRow,
	BeadSelection,
	BeadsScope,
	BeadsService,
	ReadySelection,
} from "../../src/index.ts";
import { CommandError } from "../../src/index.ts";
import { expect } from "bun:test";

const ONE = 1;
const ZERO = 0;
const BACKLOG_PRIORITY = 4;
const FUTURE = "2099-01-01T00:00:00Z";
export interface ContractSession {
	service: BeadsService;
	scope: BeadsScope;
}
export function contractSession(service: BeadsService, cwd: string, db: string): ContractSession {
	return { service, scope: { cwd, db, actor: "contract", noAutoImport: true, noAutoFlush: true } };
}

export async function filtersAndPagination({ service, scope }: ContractSession): Promise<unknown> {
	const one = await service.create(scope, {
		title: "Alpha needle",
		description: "text",
		labels: ["team", "red"],
		priority: 1,
		assignee: "alice",
	});
	await service.create(scope, {
		title: "Beta",
		labels: ["team", "blue"],
		priority: 1,
		assignee: "bob",
	});
	const three = await service.create(scope, {
		title: "Closed needle",
		labels: ["team", "red"],
		priority: 0,
	});
	await service.close(scope, three.id, { reason: "done" });
	const list = await service.list(scope, {
		labels: ["team"],
		sort: "priority",
		offset: 1,
		limit: 1,
	});
	const and = await service.list(scope, { labels: ["team", "red"], limit: 0 });
	const or = await service.list(scope, {
		labelAny: ["red", "blue"],
		excludeLabels: ["blue"],
		all: true,
		limit: 0,
	});
	const search = await service.search(scope, "needle", {
		status: ["all"],
		sort: "priority",
		limit: 0,
	});
	const exact = await service.list(scope, { ids: [one.id], priority: [ONE], limit: 0 });
	const identifiers = await service.list(scope, { ids: [one.id, three.id], all: true });
	expect(identifiers.issues.map((issue) => issue.title)).toEqual(["Closed needle", "Alpha needle"]);
	await service.create(scope, { title: "Deferred", status: "deferred" });
	await service.create(scope, { title: "Future", defer: FUTURE });
	const all = await service.list(scope, { all: true, limit: 0 });
	const open = await service.list(scope, { status: ["open"], limit: 0 });
	const ready = await service.ready(scope, { limit: 0 });
	const includingDeferred = await service.ready(scope, { includeDeferred: true, limit: 0 });
	const assigned = await service.list(scope, { assignee: "alice", limit: 0 });
	const assignedSearch = await service.search(scope, "needle", { assignee: "alice", limit: 0 });
	const emptyFilters = await service.list(scope, {
		ids: [],
		type: [],
		assignee: undefined,
		priority: [],
		status: [],
		labels: [],
		labelAny: [],
		excludeLabels: [],
		limit: 0,
	});
	const defaultList = await service.list(scope, { limit: 0 });
	expect(emptyFilters).toEqual(defaultList);
	const allTitles = all.issues.map((issue) => issue.title).toSorted();
	const openTitles = open.issues.map((issue) => issue.title).toSorted();
	const readyTitles = ready.map((issue) => issue.title).toSorted();
	expect(allTitles).toEqual(["Alpha needle", "Beta", "Closed needle", "Deferred", "Future"]);
	expect(openTitles).toEqual(["Alpha needle", "Beta", "Future"]);
	expect(readyTitles).toEqual(["Alpha needle", "Beta"]);
	expect(includingDeferred.map((issue) => issue.title).toSorted()).toEqual([
		"Alpha needle",
		"Beta",
		"Deferred",
		"Future",
	]);
	expect(assigned.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	expect(assignedSearch.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	return {
		selectionOptions: await selectionOptions({ service, scope }, one.id),
		all: allTitles,
		open: openTitles,
		ready: readyTitles,
		includingDeferred: includingDeferred.map(({ title, status }) => ({ title, status })),
		assigned: assigned.issues.map((issue) => issue.title),
		assignedSearch: assignedSearch.issues.map((issue) => issue.title),
		list: {
			titles: list.issues.map((issue) => issue.title),
			total: list.total,
			hasMore: list.has_more,
			limit: list.limit,
			offset: list.offset,
		},
		and: and.issues.map((issue) => issue.title),
		or: or.issues.map((issue) => issue.title),
		search: search.issues.map((issue) => issue.title),
		exact: exact.issues.map((issue) => issue.title),
		identifiers: pageFacts(identifiers),
	};
}

export async function labelsAndSavedQueries({ service, scope }: ContractSession): Promise<unknown> {
	const one = await service.create(scope, {
		title: "failed",
		labels: ["system", "bee", "failed", "unresolved"],
		assignee: "alice",
	});
	await service.create(scope, {
		title: "resolved",
		labels: ["system", "bee", "failed", "resolved"],
		assignee: "bob",
	});
	await service.close(scope, one.id, { reason: "failed" });
	const saved = await service.query.save(
		scope,
		"attention",
		{ labels: ["system", "bee", "failed", "unresolved"], all: true, limit: 0 },
		"attention",
	);
	const names = await service.query.list(scope);
	const duplicate = await diagnostic(() =>
		service.query.save(scope, "attention", { labels: ["system"] }),
	);
	const matches = await service.query.run(scope, "attention");
	const emptyOverride = await service.query.run(scope, "attention", {
		labels: [],
		all: false,
		limit: ZERO,
	});
	expect(emptyOverride).toEqual(matches);
	const override = await service.query.run(scope, "attention", { labels: ["resolved"] });
	await service.update(scope, [one.id], {
		setLabels: ["system", "bee", "failed", "resolved"],
		force: true,
	});
	const replaced = await service.query.run(scope, "attention");
	await service.query.save(scope, "assigned", { assignee: "alice", all: true, limit: 0 });
	const assigned = await service.query.run(scope, "assigned");
	const reassigned = await service.query.run(scope, "assigned", { assignee: "bob" });
	const unassigned = await service.query.run(scope, "assigned", { unassigned: true });
	expect(assigned.issues.map((issue) => issue.title)).toEqual(["failed"]);
	expect(reassigned.issues.map((issue) => issue.title)).toEqual(["resolved"]);
	expect(unassigned.issues).toEqual([]);
	await service.query.save(scope, "unassigned", { unassigned: true, all: true, limit: 0 });
	const assignmentOverride = await service.query.run(scope, "unassigned", { assignee: "bob" });
	expect(assignmentOverride.issues.map((issue) => issue.title)).toEqual(["resolved"]);
	const deleted = await service.query.delete(scope, "attention");
	return {
		labelMutations: await labelMutations({ service, scope }),
		saved,
		names: { queries: names.queries.map(({ name }) => ({ name })), count: names.count },
		matches: matches.issues.map((issue) => issue.title),
		override: override.issues.map((issue) => issue.title),
		replaced: replaced.issues.map((issue) => issue.title),
		assigned: assigned.issues.map((issue) => issue.title),
		reassigned: reassigned.issues.map((issue) => issue.title),
		unassigned: unassigned.issues.map((issue) => issue.title),
		assignmentOverride: assignmentOverride.issues.map((issue) => issue.title),
		deleted,
		duplicate,
		missing: await diagnostic(() => service.query.run(scope, "attention")),
	};
}

// --- Private functions ---

async function selectionOptions({ service, scope }: ContractSession, id: string): Promise<unknown> {
	await service.update(scope, [id], { notes: "notes-only token" });
	const rows: { selection: BeadSelection; titles: string[] }[] = [
		{
			selection: { type: ["task"], priority: [ZERO, ONE], all: true, sort: "title" },
			titles: ["Alpha needle", "Beta", "Closed needle"],
		},
		{
			selection: { unassigned: true, status: ["open", "deferred"], sort: "title" },
			titles: ["Deferred", "Future"],
		},
		{ selection: { assignee: "", sort: "title" }, titles: [] },
		{
			selection: { titleContains: "ALPHA", descriptionContains: "TEXT", notesContains: "ONLY" },
			titles: ["Alpha needle"],
		},
		{
			selection: { sort: "title", reverse: true, offset: 1, limit: 2 },
			titles: ["Deferred", "Beta"],
		},
		{ selection: { offset: 99, limit: 1 }, titles: [] },
		{
			selection: { sort: "created_at", limit: 0 },
			titles: ["Future", "Deferred", "Beta", "Alpha needle"],
		},
		{
			selection: { sort: "updated_at", limit: 0 },
			titles: ["Alpha needle", "Future", "Deferred", "Beta"],
		},
		{
			selection: { sort: "priority", reverse: true, limit: 0 },
			titles: ["Deferred", "Future", "Alpha needle", "Beta"],
		},
	];
	const pages = [];
	// Native selections are observed independently with their exact expected ordering.
	/* eslint-disable no-await-in-loop */
	for (const { selection, titles } of rows) {
		const page = await service.list(scope, selection);
		expect(page.issues.map((issue) => issue.title)).toEqual(titles);
		pages.push(pageFacts(page));
	}
	/* eslint-enable no-await-in-loop */
	const defaultSearch = await service.search(scope, "NEEDLE");
	expect(defaultSearch.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	expect(defaultSearch.hidden_closed_count).toBe(ONE);
	const closedSearch = await service.search(scope, "needle", { status: ["closed"], limit: 0 });
	expect(closedSearch.issues.map((issue) => issue.title)).toEqual(["Closed needle"]);
	expect(closedSearch.hidden_closed_count).toBe(ZERO);
	const filteredHidden = await service.search(scope, "needle", { excludeLabels: ["red"] });
	expect(filteredHidden.hidden_closed_count).toBe(ZERO);
	const notesSearch = await service.search(scope, "notes-only token");
	expect(notesSearch.issues).toEqual([]);
	const idSearch = await service.search(scope, id);
	expect(idSearch.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	const comment = await service.comments.add(scope, id, "Comment-only searchable token");
	const commentSearch = await service.search(scope, "COMMENT-ONLY");
	expect(commentSearch.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	const commentNotes = await service.list(scope, { notesContains: "Comment-only" });
	expect(commentNotes.issues).toEqual([]);
	const searchSelections: BeadSelection[] = [
		{
			status: ["open"],
			type: ["task"],
			priority: [ONE],
			ids: [id],
			labels: ["team", "red"],
			labelAny: ["red", "absent"],
			unassigned: false,
			titleContains: "alpha",
			descriptionContains: "text",
			notesContains: "only",
			limit: 1,
			offset: 0,
			sort: "title",
			reverse: true,
		},
		{ all: true, limit: ONE, offset: ONE, sort: "created_at" },
		{ all: true, limit: 0, sort: "updated_at", reverse: true },
		{ all: true, unassigned: true, limit: 0 },
		{ all: true, offset: 99, limit: 1 },
	];
	const searches = [];
	// Search exercises the shared exposed selection options through its own native query path.
	/* eslint-disable no-await-in-loop */
	for (const selection of searchSelections) {
		searches.push(pageFacts(await service.search(scope, "needle", selection)));
	}
	/* eslint-enable no-await-in-loop */
	const futureSearch = await service.search(scope, "Future");
	expect(futureSearch.issues.map((issue) => issue.title)).toEqual(["Future"]);
	const futureDefault = await service.search(scope, "Future", { status: ["open"] });
	expect(futureDefault.issues.map((issue) => issue.title)).toEqual(["Future"]);
	const futureShown = await service.search(scope, "Future", { status: ["open"], deferred: true });
	expect(futureShown.issues.map((issue) => issue.title)).toEqual(["Future"]);
	const readySelections: ReadySelection[] = [
		{
			assignee: "alice",
			labels: ["team", "red"],
			labelAny: ["red", "absent"],
			priority: 1,
			type: "task",
			limit: 1,
			sort: "priority",
		},
		{ unassigned: true, includeDeferred: true, sort: "oldest", limit: 0 },
		{ labelAny: ["blue", "red"], sort: "hybrid", limit: 1 },
	];
	const ready = [];
	/* eslint-disable no-await-in-loop -- Ready options have a distinct native brief projection. */
	for (const selection of readySelections) {
		const selected = await service.ready(scope, selection);
		ready.push(selected.map(({ title, status, labels }) => ({ title, status, labels })));
	}
	/* eslint-enable no-await-in-loop */
	await service.create(scope, { title: "Gamma", priority: 0, type: "bug" });
	const delta = await service.create(scope, { title: "Delta", priority: BACKLOG_PRIORITY });
	const typed = await service.list(scope, {
		type: ["bug", "feature"],
		priority: [ZERO, BACKLOG_PRIORITY],
	});
	expect(typed.issues.map((issue) => issue.title)).toEqual(["Gamma"]);
	const batchReceipts = await service.update(scope, [id, delta.id], { design: "batch design" });
	expect(batchReceipts.map((receipt) => receipt.id)).toEqual([id, delta.id]);
	const batchUpdated = await service.showMany(scope, [id, delta.id]);
	expect(batchUpdated.map((issue) => issue.design)).toEqual(["batch design", "batch design"]);
	const readySorts: { sort: ReadySelection["sort"]; titles: string[] }[] = [
		{ sort: "hybrid", titles: ["Alpha needle", "Beta", "Gamma", "Delta"] },
		{ sort: "priority", titles: ["Gamma", "Alpha needle", "Beta", "Delta"] },
		{ sort: "oldest", titles: ["Alpha needle", "Beta", "Gamma", "Delta"] },
	];
	/* eslint-disable no-await-in-loop -- Priority-first and age-first policies require distinct ordering fixtures. */
	for (const { sort, titles } of readySorts) {
		const selected = await service.ready(scope, { sort });
		expect(selected.map((issue) => issue.title)).toEqual(titles);
	}
	/* eslint-enable no-await-in-loop */
	const readyBugs = await service.ready(scope, { type: "bug", unassigned: true });
	expect(readyBugs.map((issue) => issue.title)).toEqual(["Gamma"]);
	const defaultPage = await service.list(scope);
	expect(defaultPage.limit).toBe(ZERO);
	const listDeferred = await service.list(scope, { deferred: true });
	expect(listDeferred).toEqual(defaultPage);
	const descriptionSearch = await service.search(scope, "TEXT");
	expect(descriptionSearch.issues.map((issue) => issue.title)).toEqual(["Alpha needle"]);
	const searchOpen = await service.search(scope, "needle", { status: ["open"] });
	expect(searchOpen.hidden_closed_count).toBe(ONE);
	return {
		pages,
		defaultSearch: pageFacts(defaultSearch),
		closedSearch: pageFacts(closedSearch),
		searches,
		ready,
		commentText: comment.text,
	};
}
function pageFacts(page: {
	issues: BeadRow[];
	limit: number;
	offset: number;
	has_more: boolean;
	total?: number;
	hidden_closed_count?: number;
}): unknown {
	return {
		titles: page.issues.map((issue) => issue.title),
		limit: page.limit,
		offset: page.offset,
		hasMore: page.has_more,
		total: page.total,
		hiddenClosed: page.hidden_closed_count,
	};
}

async function labelMutations({ service, scope }: ContractSession): Promise<unknown> {
	const issue = await service.create(scope, {
		title: "labels",
		labels: ["base", "base", "Case", " x,y ", ""],
	});
	expect(issue.labels).toEqual(["Case", "base", "x", "y"]);
	const invalidBefore = await service.show(scope, issue.id);
	const commaMutation = await diagnostic(() =>
		service.update(scope, [issue.id], { addLabels: ["one", "literal,comma"] }),
	);
	expect(await service.show(scope, issue.id)).toEqual(invalidBefore);
	await service.update(scope, [issue.id], {
		addLabels: ["one", "two", "one"],
		removeLabels: ["base", "y", "y"],
	});
	const added = await service.show(scope, issue.id);
	expect(added.labels).toEqual(["Case", "one", "two", "x"]);
	changedRevision(issue, added);
	await service.update(scope, [issue.id], { addLabels: ["one", "two"], removeLabels: ["absent"] });
	expect(await service.show(scope, issue.id)).toEqual(added);
	await service.update(scope, [issue.id], {
		addLabels: ["transient"],
		removeLabels: ["transient"],
	});
	const transient = await service.show(scope, issue.id);
	expect(transient.labels).toEqual(added.labels);
	changedRevision(added, transient);
	const exactFilters: BeadSelection[] = [
		{ labels: ["one,two", "Case"] },
		{ labels: ["one", "two", "Case"] },
		{ labels: ["case"] },
		{ labelAny: ["one,two", "absent"] },
		{ excludeLabels: ["one,two"] },
		{ excludeLabels: ["Case"] },
	];
	const filtered = [];
	/* eslint-disable no-await-in-loop -- Literal label groups must retain commas and case through native filtering. */
	for (const selection of exactFilters) {
		const selected = await service.list(scope, { ...selection, ids: [issue.id] });
		filtered.push(selected.issues.map((row) => row.title));
	}
	/* eslint-enable no-await-in-loop */
	expect(filtered).toEqual([[], ["labels"], [], [], ["labels"], []]);
	await service.update(scope, [issue.id], {
		setLabels: [" replacement ", "Case", "replacement"],
		addLabels: ["discarded"],
		removeLabels: ["Case"],
	});
	const replaced = await service.show(scope, issue.id);
	expect(replaced.labels).toEqual(["Case", "replacement"]);
	await service.update(scope, [issue.id], {
		labels: ["alias"],
		setLabels: ["combined"],
		addLabels: ["discarded"],
	});
	const alias = await service.show(scope, issue.id);
	expect(alias.labels).toEqual(["alias", "combined"]);
	await service.update(scope, [issue.id], { labels: [] });
	const empty = await service.show(scope, issue.id);
	expect(empty.labels).toEqual([]);
	changedRevision(alias, empty);
	await service.query.save(
		scope,
		"z-options",
		{ ids: [issue.id], sort: "title", reverse: true, limit: 1, offset: 0 },
		"Option preset",
	);
	await service.query.save(scope, "A-options", { labels: ["absent"], all: true });
	const queries = await service.query.list(scope);
	for (const query of queries.queries) {
		validTimestamp(query.created_at);
	}
	expect(queries.queries.map((query) => query.name)).toEqual([
		"A-options",
		"assigned",
		"unassigned",
		"z-options",
	]);
	expect(queries.queries.find((query) => query.name === "z-options")?.description).toBe(
		"Option preset",
	);
	const queryPage = await service.query.run(scope, "z-options");
	expect(queryPage.issues.map((row) => row.title)).toEqual(["labels"]);
	const missingDelete = await diagnostic(() => service.query.delete(scope, "missing"));
	return {
		commaMutation,
		filtered,
		replaced: replaced.labels,
		alias: alias.labels,
		empty: empty.labels,
		queries: queries.queries.map(({ name, description }) => ({ name, description })),
		queryPage: pageFacts(queryPage),
		missingDelete,
	};
}
function validTimestamp(timestamp: string): void {
	expect(timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u);
	expect(Number.isFinite(Date.parse(timestamp))).toBe(true);
}
function changedRevision(before: BeadRow, after: BeadRow): void {
	validTimestamp(after.updated_at);
	expect(after.updated_at).not.toBe(before.updated_at);
	expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at));
}

async function diagnostic(operation: () => Promise<unknown>): Promise<unknown> {
	try {
		await operation();
	} catch (error) {
		expect(error).toBeInstanceOf(CommandError);
		if (error instanceof CommandError) {
			return {
				code: error.code,
				nativeCode: error.nativeError?.code,
				field: error.nativeError?.context?.field,
			};
		}
		throw error;
	}
	throw new Error("Expected command failure");
}
