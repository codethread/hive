/* eslint-disable max-statements -- Bounded differential traces keep observations beside their mutations. */
import type { BeadsScope, BeadsService, CreateBead } from "../../src/index.ts";
import { CommandError } from "../../src/index.ts";
import { expect } from "bun:test";

const ONE = 1;
const ZERO = 0;
const FUTURE = "2099-01-01T00:00:00Z";
export interface ContractSession {
	service: BeadsService;
	scope: BeadsScope;
}
export function contractSession(service: BeadsService, cwd: string, db: string): ContractSession {
	return { service, scope: { cwd, db, actor: "contract" } };
}
export async function revisionsAndClaims({ service, scope }: ContractSession): Promise<unknown> {
	const created = await service.create(scope, { title: "claim", owner: "ct" });
	const { id } = created;
	const before = await service.show(scope, id);
	expect(before.updated_at).toBe(created.updated_at);
	await service.update(scope, [id], { claim: true, ifUnchanged: before.updated_at });
	const claimed = await service.show(scope, id);
	expect(claimed.updated_at).not.toBe(before.updated_at);
	const batchTarget = await service.create(scope, { title: "batch CAS target" });
	const batchBefore = await service.showMany(scope, [id, batchTarget.id]);
	const batchConflict = await diagnostic(() =>
		service.update(scope, [id, batchTarget.id], {
			title: "partial write",
			ifUnchanged: claimed.updated_at,
		}),
	);
	expect(await service.showMany(scope, [id, batchTarget.id])).toEqual(batchBefore);
	const batchClaimConflict = await diagnostic(() =>
		service.update({ ...scope, actor: "other" }, [batchTarget.id, id], { claim: true }),
	);
	expect(await service.showMany(scope, [id, batchTarget.id])).toEqual(batchBefore);
	const stale = await diagnostic(() =>
		service.update(scope, [id], { description: "stale", ifUnchanged: before.updated_at }),
	);
	const conflict = await diagnostic(() =>
		service.update({ ...scope, actor: "other" }, [id], { claim: true }),
	);
	const after = await service.show(scope, id);
	expect(after).toEqual(claimed);
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
		deferredClaims,
		batchConflict,
		batchClaimConflict,
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
	};
}
export async function relationsAndReadiness({ service, scope }: ContractSession): Promise<unknown> {
	const parent = await service.create(scope, { title: "parent", type: "epic" });
	const blocker = await service.create(scope, { title: "blocker" });
	const child = await service.create(scope, { title: "child", parent: parent.id });
	const related = await service.create(scope, {
		title: "related",
		deps: [{ id: child.id, type: "related" }],
	});
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
