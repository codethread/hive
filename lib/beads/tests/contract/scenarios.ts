/* eslint-disable max-statements -- Bounded differential traces keep observations beside their mutations. */
import type {
	BeadRow,
	BeadSelection,
	BeadsScope,
	BeadsService,
	CreateBead,
	ReadySelection,
} from "../../src/index.ts";
import { CommandError } from "../../src/index.ts";
import { expect } from "bun:test";

const ONE = 1;
const ZERO = 0;
const BACKLOG_PRIORITY = 4;
const FRACTION_PREFIX_LENGTH = 9;
const FUTURE = "2099-01-01T00:00:00Z";
export interface ContractSession {
	service: BeadsService;
	scope: BeadsScope;
}
export function contractSession(service: BeadsService, cwd: string, db: string): ContractSession {
	return { service, scope: { cwd, db, actor: "contract", noAutoImport: true, noAutoFlush: true } };
}
export async function revisionsAndClaims({ service, scope }: ContractSession): Promise<unknown> {
	const created = await service.create(scope, { title: "claim", owner: "ct" });
	const { id } = created;
	const before = await service.show(scope, id);
	expect(before.updated_at).toBe(created.updated_at);
	await service.update(scope, [id], { claim: true, ifUnchanged: before.updated_at });
	const claimed = await service.show(scope, id);
	expect(claimed.updated_at).not.toBe(before.updated_at);
	const sameActor = await service.update(scope, [id], { claim: true });
	const reclaimed = await service.show(scope, id);
	changedRevision(claimed, reclaimed);
	expect(sameActor[ZERO]?.assignee).toBe(scope.actor!);
	const batchTarget = await service.create(scope, { title: "batch CAS target" });
	await service.update(scope, [batchTarget.id], { appendNotes: "first note" });
	const batchBefore = await service.showMany(scope, [id, batchTarget.id]);
	expect(batchBefore[ONE]?.notes).toBe("first note");
	const batchConflict = await diagnostic(() =>
		service.update(scope, [id, batchTarget.id], {
			title: "partial write",
			ifUnchanged: reclaimed.updated_at,
		}),
	);
	expect(await service.showMany(scope, [id, batchTarget.id])).toEqual(batchBefore);
	const batchClaimConflict = await diagnostic(() =>
		service.update({ ...scope, actor: "other" }, [batchTarget.id, id], { claim: true }),
	);
	expect(await service.showMany(scope, [id, batchTarget.id])).toEqual(batchBefore);
	const readOrder = await service.showMany(scope, [batchTarget.id, id, batchTarget.id]);
	expect(readOrder.map((issue) => issue.title)).toEqual([
		"batch CAS target",
		"claim",
		"batch CAS target",
	]);
	const missingBatch = await diagnostic(() =>
		service.update(scope, [batchTarget.id, "mem-missing"], { addLabels: ["partial"] }),
	);
	expect(await service.showMany(scope, [id, batchTarget.id])).toEqual(batchBefore);
	const stale = await diagnostic(() =>
		service.update(scope, [id], { description: "stale", ifUnchanged: before.updated_at }),
	);
	const conflict = await diagnostic(() =>
		service.update({ ...scope, actor: "other" }, [id], { claim: true }),
	);
	const after = await service.show(scope, id);
	expect(after).toEqual(reclaimed);
	const update = await service.update(scope, [id], {
		assignee: "",
		status: "open",
		ifUnchanged: after.updated_at,
	});
	const comment = await service.comments.add({ ...scope, actor: "observer" }, id, "observation");
	const observed = await service.show(scope, id);
	expect(comment.issue_id).toBe(id);
	expect(await service.comments.list(scope, id)).toEqual(observed.comments);
	await service.update(scope, [id], { notes: "long notes preserve context" });
	const overwrite = await diagnostic(() => service.update(scope, [id], { notes: "short" }));
	await service.update(scope, [id], { notes: "short", force: true });
	const { notes } = await service.show(scope, id);
	const deferredClaims = [
		await rejectedDeferredClaim({ service, scope }, { status: "deferred" }),
		await rejectedDeferredClaim({ service, scope }, { defer: FUTURE }),
	];
	return {
		content: await contentAndRevisions({ service, scope }),
		deferredClaims,
		batchConflict,
		batchClaimConflict,
		missingBatch,
		overwrite,
		notes,
		createdBy: created.created_by,
		claimed: { status: claimed.status, assignee: claimed.assignee, owner: claimed.owner },
		stale,
		conflict,
		update: update.map(({ assignee, owner, status }) => ({ assignee, owner, status })),
		comment: { author: comment.author, text: comment.text },
		comments: observed.comments.map(({ author, text }) => ({ author, text })),
		missing: await diagnostic(() => service.show(scope, "mem-missing")),
	};
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
export async function relationsAndReadiness({ service, scope }: ContractSession): Promise<unknown> {
	const parent = await service.create(scope, { title: "parent", type: "epic" });
	const blocker = await service.create(scope, { title: "blocker" });
	const child = await service.create(scope, { title: "child", parent: parent.id });
	const related = await service.create(scope, {
		title: "related",
		deps: [
			{ id: child.id, type: "related" },
			{ id: child.id, type: "related" },
		],
	});
	const relatedRecord = await service.show(scope, related.id);
	expect(relatedRecord.dependencies).toHaveLength(ONE);
	const added = await service.dep.add(scope, child.id, blocker.id);
	const duplicate = await service.dep.add(scope, child.id, blocker.id);
	const cycle = await diagnostic(() => service.dep.add(scope, blocker.id, child.id));
	const hydrated = await service.show(scope, child.id);
	const blockers = await diagnostic(() => service.update(scope, [child.id], { claim: true }));
	const closeBlocked = await diagnostic(() => service.close(scope, child.id, { reason: "done" }));
	const closeParent = await diagnostic(() => service.close(scope, parent.id, { reason: "done" }));
	const taskParent = await service.create(scope, { title: "task parent" });
	await service.create(scope, { title: "unfinished task child", parent: taskParent.id });
	const closeTaskParent = await diagnostic(() =>
		service.close(scope, taskParent.id, { reason: "done" }),
	);
	const inheritedChild = await service.create(scope, {
		title: "inherited blocker child",
		parent: parent.id,
	});
	await service.dep.add(scope, parent.id, blocker.id);
	const ready = await service.ready(scope, { limit: 0 });
	expect(ready.map((issue) => issue.title)).toContain("task parent");
	expect(ready.map((issue) => issue.title)).not.toContain("parent");
	expect(ready.map((issue) => issue.title)).not.toContain("inherited blocker child");
	await service.close(scope, inheritedChild.id, { reason: "done" });
	const closedInheritedChild = await service.show(scope, inheritedChild.id);
	expect(closedInheritedChild.status).toBe("closed");
	await service.close(scope, blocker.id, { reason: "done" });
	const unblocked = await service.ready(scope, { limit: 0 });
	await service.close(scope, related.id, { reason: "done" });
	await service.close(scope, child.id, { reason: "done" });
	await service.close(scope, parent.id, { reason: "done" });
	const closed = await service.show(scope, child.id);
	const terminalBefore = await service.showMany(scope, [taskParent.id, child.id]);
	const terminalUpdates = [];
	/* eslint-disable no-await-in-loop -- Each rejected batch must preserve its original records. */
	for (const status of ["closed", "tombstone"]) {
		const rejected = await diagnostic(() =>
			service.update(scope, [taskParent.id, child.id], {
				status,
				title: "partial terminal write",
				addLabels: ["partial"],
				force: true,
			}),
		);
		expect(rejected).toEqual({ code: 4, nativeCode: "VALIDATION_FAILED", field: "status" });
		expect(await service.showMany(scope, [taskParent.id, child.id])).toEqual(terminalBefore);
		terminalUpdates.push(rejected);
	}
	/* eslint-enable no-await-in-loop */
	const createdClosed = await service.create(scope, { title: "closed fixture", status: "closed" });
	expect(typeof createdClosed.closed_at).toBe("string");
	await service.update(scope, [child.id], { status: "open" });
	const reopened = await service.show(scope, child.id);
	expect(reopened.closed_at).toBeUndefined();
	expect(reopened.close_reason).toBeUndefined();
	const removed = await service.dep.remove(scope, related.id, child.id, "related");
	const afterRemoval = await service.show(scope, related.id);
	expect(afterRemoval.dependencies).toHaveLength(ZERO);
	return {
		mutations: await relationshipMutations({ service, scope }),
		outgoing: hydrated.dependencies.map((dep) => dep.dependency_type).toSorted(),
		incoming: hydrated.dependents.map((dep) => dep.dependency_type).toSorted(),
		blockers,
		cycle,
		edgeActions: `${added.action}/${duplicate.action}/${removed.action}`,
		closeBlocked,
		closeParent,
		closeTaskParent,
		closeInheritedChild: closedInheritedChild.status,
		terminalUpdates,
		createdClosed: {
			status: createdClosed.status,
			closedAt: typeof createdClosed.closed_at,
			reason: createdClosed.close_reason,
		},
		reopened: {
			status: reopened.status,
			closedAt: reopened.closed_at,
			reason: reopened.close_reason,
		},
		ready: ready.map((issue) => issue.title).toSorted(),
		unblocked: unblocked.map((issue) => issue.title).toSorted(),
		close: {
			status: closed.status,
			reason: closed.close_reason,
			closedAt: typeof closed.closed_at,
		},
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
async function contentAndRevisions({ service, scope }: ContractSession): Promise<unknown> {
	const location = await service.where(scope);
	expect(location.database_path).toBe(scope.db!);
	expect(location.beads_dir).toBeUndefined();
	expect(await service.showMany(scope, [])).toEqual([]);
	const created = await service.create(scope, {
		title: "content",
		description: "Initial description with retained context",
		type: "bug",
		priority: 0,
		owner: "ct",
		assignee: "initial",
		acceptanceCriteria: "- [ ] Verify native facts",
		defer: "-1w",
		due: "+2d",
	});
	expect(created.created_at).toBe(created.updated_at);
	validTimestamp(created.created_at);
	expect(Date.parse(created.defer_until!)).toBeLessThan(Date.parse(created.created_at));
	expect(Date.parse(created.due_at!)).toBeGreaterThan(Date.parse(created.created_at));
	await service.update(scope, [created.id], { defer: "+30m", due: "+1h" });
	const relativeDates = await service.show(scope, created.id);
	expect(Date.parse(relativeDates.defer_until!)).toBeGreaterThan(
		Date.parse(relativeDates.updated_at),
	);
	expect(Date.parse(relativeDates.due_at!)).toBeGreaterThan(Date.parse(relativeDates.defer_until!));
	await service.update(scope, [created.id], {
		due: "1969-12-31T22:59:59.123456789-01:00",
		defer: "2099-01-01",
	});
	const preciseDates = await service.show(scope, created.id);
	expect(preciseDates.due_at).toBe("1969-12-31T23:59:59.123456789Z");
	expect(Date.parse(preciseDates.defer_until!)).toBe(new Date("2099-01-01T09:00:00").getTime());
	const invalidDate = await diagnostic(() =>
		service.update(scope, [created.id], { due: "invalid date", title: "partial date write" }),
	);
	expect(await service.show(scope, created.id)).toEqual(preciseDates);
	const receipts = await service.update(scope, [created.id], {
		title: "edited content",
		description: "Edited description with retained context",
		type: "feature",
		priority: 3,
		owner: "editor",
		assignee: "editor",
		notes: "  padded  \r\n\n",
		design: "Design with retained context",
		acceptanceCriteria: "- [x] Verify native facts",
		defer: FUTURE,
		due: "2000-01-01T00:00:00Z",
	});
	const edited = await service.show(scope, created.id);
	expect(receipts[ZERO]!.updated_at.replace(/\+00:00$/u, "Z")).toBe(edited.updated_at);
	changedRevision(created, edited);
	await service.update(scope, [created.id], { appendNotes: "block\nwith lines" });
	const appended = await service.show(scope, created.id);
	expect(appended.notes).toBe("  padded  \r\n\nblock\nwith lines");
	changedRevision(edited, appended);
	await service.update(scope, [created.id], { appendNotes: "block\nwith lines" });
	expect(await service.show(scope, created.id)).toEqual(appended);
	await service.update(scope, [created.id], { appendNotes: "lines" });
	const suffix = await service.show(scope, created.id);
	expect(suffix.notes).toBe(`${appended.notes}\nlines`);
	changedRevision(appended, suffix);
	const blankAppend = await diagnostic(() =>
		service.update(scope, [created.id], { appendNotes: " \n " }),
	);
	expect(await service.show(scope, created.id)).toEqual(suffix);
	const invalidCas = await diagnostic(() =>
		service.update(scope, [created.id], {
			title: "invalid CAS",
			ifUnchanged: "not-a-timestamp",
			force: true,
		}),
	);
	expect(await service.show(scope, created.id)).toEqual(suffix);
	const precisionCas = await diagnostic(() =>
		service.update(scope, [created.id], {
			title: "precision CAS",
			ifUnchanged: suffix.updated_at.replace(
				/(?:\.\d+)?Z$/u,
				(fraction) => `${fraction.slice(ZERO, -ONE).padEnd(FRACTION_PREFIX_LENGTH, "0")}1Z`,
			),
			force: true,
		}),
	);
	expect(await service.show(scope, created.id)).toEqual(suffix);
	const shortOverwrite = await diagnostic(() =>
		service.update(scope, [created.id], { description: "", design: "", acceptanceCriteria: "" }),
	);
	await service.update(scope, [created.id], {
		owner: "",
		assignee: "",
		defer: "",
		due: "",
		force: true,
		description: "",
		design: "",
		acceptanceCriteria: "",
	});
	const cleared = await service.show(scope, created.id);
	expect(cleared.owner).toBeUndefined();
	expect(cleared.assignee).toBeUndefined();
	expect(cleared.defer_until).toBeUndefined();
	expect(cleared.due_at).toBeUndefined();
	await service.update(scope, [created.id], {
		appendNotes: "CAS equivalent timestamp",
		ifUnchanged: `  ${cleared.updated_at.replace(/Z$/u, "+00:00")}  `,
	});
	const commentedBefore = await service.show(scope, created.id);
	const blankComment = await diagnostic(() => service.comments.add(scope, created.id, " \n "));
	expect(await service.show(scope, created.id)).toEqual(commentedBefore);
	const text = `Bee acknowledgment: ${JSON.stringify({ closedAt: cleared.updated_at, reason: "Accepted ✓\nseparately" })}`;
	const comment = await service.comments.add({ ...scope, actor: "acknowledger" }, created.id, text);
	const commented = await service.show(scope, created.id);
	validTimestamp(comment.created_at);
	expect(comment.text).toBe(text);
	expect(comment.id).toBeGreaterThan(ZERO);
	expect(comment.issue_id).toBe(created.id);
	expect(commented.comments).toEqual([comment]);
	expect(await service.comments.list(scope, created.id)).toEqual([comment]);
	changedRevision(commentedBefore, commented);
	const repeatedComment = await service.comments.add(scope, created.id, text);
	expect(repeatedComment.id).toBeGreaterThan(comment.id);
	expect(repeatedComment.text).toBe(text);
	expect(await service.comments.list(scope, created.id)).toEqual([comment, repeatedComment]);
	const commentConflict = await diagnostic(() =>
		service.update(scope, [created.id], {
			title: "stale comment",
			ifUnchanged: commentedBefore.updated_at,
		}),
	);
	const closedReceipt = await service.close(scope, created.id);
	const closed = await service.show(scope, created.id);
	expect(closedReceipt[ZERO]!.closed_at.replace(/\+00:00$/u, "Z")).toBe(closed.closed_at!);
	expect(Date.parse(closed.updated_at)).toBeGreaterThanOrEqual(Date.parse(closed.closed_at!));
	const closedClaim = await diagnostic(() =>
		service.update(scope, [created.id], { claim: true, force: true }),
	);
	expect(await service.show(scope, created.id)).toEqual(closed);
	return {
		edited: contentFacts(edited),
		cleared: contentFacts(cleared),
		blankAppend,
		invalidDate,
		invalidCas,
		precisionCas,
		shortOverwrite,
		comment: {
			text: comment.text.replace(cleared.updated_at, "<revision>"),
			author: comment.author,
		},
		commentConflict,
		blankComment,
		closedClaim,
		closeReason: closed.close_reason,
	};
}
function contentFacts(issue: BeadRow): unknown {
	return {
		title: issue.title,
		description: issue.description,
		type: issue.issue_type,
		priority: issue.priority,
		owner: issue.owner,
		assignee: issue.assignee,
		notes: issue.notes,
		design: issue.design,
		acceptance: issue.acceptance_criteria,
		defer: issue.defer_until && Date.parse(issue.defer_until),
		due: issue.due_at && Date.parse(issue.due_at),
	};
}
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
	/* eslint-disable no-await-in-loop -- Native selections are observed independently with their exact expected ordering. */
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
	/* eslint-disable no-await-in-loop -- Search exercises the shared exposed selection options through its own native query path. */
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
async function relationshipMutations({ service, scope }: ContractSession): Promise<unknown> {
	const first = await service.create(scope, { title: "first parent", type: "epic" });
	const second = await service.create(scope, { title: "second parent", type: "epic" });
	const child = await service.create(scope, { title: "moving child", parent: first.id });
	const before = await service.show(scope, child.id);
	await service.update(scope, [child.id], { parent: second.id });
	const reparented = await service.show(scope, child.id);
	changedRevision(before, reparented);
	expect(reparented.id).toBe(child.id);
	expect(reparented.dependencies.map((dep) => dep.id)).toEqual([second.id]);
	const previousParent = await service.show(scope, first.id);
	expect(previousParent.dependents).toEqual([]);
	const oldChildren = await service.ready(scope, { parent: first.id });
	expect(oldChildren.map((issue) => issue.title)).toEqual([]);
	const newChildren = await service.ready(scope, { parent: second.id });
	expect(newChildren.map((issue) => issue.title)).toEqual(["moving child"]);
	await service.update(scope, [child.id], { parent: second.id });
	expect(await service.show(scope, child.id)).toEqual(reparented);
	const parentCycle = await diagnostic(() =>
		service.update(scope, [second.id], { parent: child.id }),
	);
	const selfParent = await diagnostic(() =>
		service.update(scope, [child.id], { parent: child.id }),
	);
	expect(await service.show(scope, child.id)).toEqual(reparented);
	await service.update(scope, [child.id], { parent: "" });
	const detached = await service.show(scope, child.id);
	changedRevision(reparented, detached);
	expect(detached.dependencies).toEqual([]);
	await service.update(scope, [child.id], { parent: "" });
	expect(await service.show(scope, child.id)).toEqual(detached);
	const added = await service.dep.add(scope, child.id, first.id, "related");
	const linked = await service.show(scope, child.id);
	changedRevision(detached, linked);
	expect(await service.dep.add(scope, child.id, first.id, "related")).toEqual({
		...added,
		status: "exists",
		action: "already_exists",
	});
	expect(await service.show(scope, child.id)).toEqual(linked);
	await service.dep.add(scope, child.id, first.id, "blocks");
	const ambiguousBefore = await service.show(scope, child.id);
	const ambiguous = await diagnostic(() => service.dep.remove(scope, child.id, first.id));
	expect(await service.show(scope, child.id)).toEqual(ambiguousBefore);
	const removed = await service.dep.remove(scope, child.id, first.id, "related");
	const removedRecord = await service.show(scope, child.id);
	changedRevision(ambiguousBefore, removedRecord);
	const missing = await service.dep.remove(scope, child.id, first.id, "related");
	expect(missing.action).toBe("not_found");
	expect(await service.show(scope, child.id)).toEqual(removedRecord);
	const batchBefore = await service.showMany(scope, [second.id, child.id]);
	const blockedBatch = await diagnostic(() =>
		service.update(scope, [second.id, child.id], { claim: true }),
	);
	expect(await service.showMany(scope, [second.id, child.id])).toEqual(batchBefore);
	await service.update(scope, [child.id], { claim: true, force: true });
	const forced = await service.show(scope, child.id);
	expect(forced.status).toBe("in_progress");
	const forcedReceipt = await service.close(scope, child.id, {
		reason: "forced close",
		force: true,
	});
	const closed = await service.show(scope, child.id);
	expect(forcedReceipt[ZERO]!.closed_at.replace(/\+00:00$/u, "Z")).toBe(closed.closed_at!);
	const repeatedClose = await diagnostic(() => service.close(scope, child.id));
	expect(await service.show(scope, child.id)).toEqual(closed);
	const untypedRemoval = await service.dep.remove(scope, child.id, first.id);
	expect(untypedRemoval.type).toBe("blocks");
	const missingClose = await diagnostic(() => service.close(scope, "mem-missing"));
	const superseding = await service.create(scope, {
		title: "superseding",
		deps: [{ id: child.id, type: "supersedes" }],
	});
	const replacement = await service.show(scope, superseding.id);
	expect(replacement.dependencies[ZERO]).toMatchObject({
		id: child.id,
		title: "moving child",
		status: "closed",
		priority: 2,
		dependency_type: "supersedes",
	});
	const initiallyReady = await service.ready(scope);
	expect(initiallyReady.map((issue) => issue.title)).toContain("superseding");
	const selfDependency = await diagnostic(() =>
		service.dep.add(scope, superseding.id, superseding.id, "related"),
	);
	await service.dep.add(scope, superseding.id, first.id, "conditional-blocks");
	const conditionallyBlocked = await service.ready(scope);
	expect(conditionallyBlocked.map((issue) => issue.title)).not.toContain("superseding");
	const typedCycle = await diagnostic(() =>
		service.dep.add(scope, first.id, superseding.id, "waits-for"),
	);
	const typedClaim = await diagnostic(() =>
		service.update(scope, [superseding.id], { claim: true }),
	);
	await service.dep.remove(scope, superseding.id, first.id, "conditional-blocks");
	await service.dep.add(scope, superseding.id, first.id, "waits-for");
	const typedClose = await diagnostic(() => service.close(scope, superseding.id));
	await service.close(scope, first.id);
	const finallyReady = await service.ready(scope);
	expect(finallyReady.map((issue) => issue.title)).toContain("superseding");
	return {
		parentCycle,
		selfParent,
		ambiguous,
		blockedBatch,
		repeatedClose,
		missingClose,
		selfDependency,
		typedCycle,
		typedClaim,
		typedClose,
		actions: [added.action, removed.action, missing.action, untypedRemoval.action],
		forced: { status: forced.status, assignee: forced.assignee },
		close: { status: closed.status, reason: closed.close_reason },
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
async function rejectedDeferredClaim(
	{ service, scope }: ContractSession,
	deferral: Partial<CreateBead>,
): Promise<unknown> {
	const deferred = await service.create(scope, { title: "deferred claim", ...deferral });
	const original = await service.show(scope, deferred.id);
	const rejected = await diagnostic(() => service.update(scope, [deferred.id], { claim: true }));
	expect(rejected).toEqual({ code: 4, nativeCode: "VALIDATION_FAILED", field: "claim" });
	expect(await service.show(scope, deferred.id)).toEqual(original);
	return rejected;
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
