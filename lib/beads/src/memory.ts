/* eslint-disable max-params -- Native dep/query operations keep explicit scope, identifiers and named options together. */
/* eslint-disable max-statements -- Atomic mutations validate their prerequisites before writing. */
/* eslint-disable unicorn/no-null -- Native update receipts report null for cleared assignment and ownership. */
import type {
	BeadCloseReceipt,
	BeadPage,
	BeadRecord,
	BeadRow,
	BeadSearchPage,
	BeadSelection,
	BeadUpdateReceipt,
	BeadsScope,
	BeadsService,
	CreateBead,
	CreatedBead,
	DependencyReceipt,
	QueryReceipt,
	ReadyBead,
	ReadySelection,
	SavedQuery,
	UpdateBead,
} from "./service.ts";
import type { BeadComment } from "./model.ts";
import { CommandError } from "./model.ts";

const ZERO = 0;
const ONE = 1;
const DEFAULT_PRIORITY = 2;
const CONFLICT = 6;
const VALIDATION = 4;
const NOT_FOUND = 3;
const CYCLE = 5;
const HALF = 2;
const SEARCH_LIMIT = 50;
const EPOCH = "2026-01-01T00:00:00.000Z";
const NANOS_PER_SECOND = 1_000_000_000n;
const ZERO_NANOS = 0n;
const ONE_SECOND = 1n;
const FRACTION_GROUP_SIZE = 3;
const MILLIS_PER_SECOND = 1000;
const NANOS_PRECISION = 9;
const BLOCKING_TYPES = new Set(["blocks", "conditional-blocks", "waits-for"]);
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;
const MORNING_HOUR = 9;
const EVENING_HOUR = 17;
const NEXT_WEEK_DAYS = 7;
const RELATIVE_UNITS = new Map([
	["m", MINUTE_MS],
	["h", HOUR_MS],
	["d", DAY_MS],
	["w", WEEK_MS],
]);

export interface MemoryBeadsOptions {
	/** Default fixture database identity when an operation has no explicit db. */
	db?: string;
	/** Default fixture attribution when an operation has no explicit actor. */
	actor?: string;
	/** Fixture clock in RFC3339; revisions remain monotonically increasing. */
	now?: () => string;
}
interface Issue {
	id: string;
	title: string;
	description: string;
	issue_type: string;
	priority: number;
	status: string;
	assignee?: string;
	owner?: string;
	created_by: string;
	created_at: string;
	updated_at: string;
	closed_at?: string;
	close_reason?: string;
	notes: string;
	design: string;
	acceptance_criteria: string;
	defer_until?: string;
	due_at?: string;
	labels: string[];
}
interface Edge {
	source: string;
	target: string;
	type: string;
}
interface Query extends SavedQuery {
	selection: BeadSelection;
}
interface Store {
	now: () => string;
	issues: Map<string, Issue>;
	comments: BeadComment[];
	edges: Edge[];
	queries: Map<string, Query>;
	sequence: number;
	revision: number;
}
interface Operation {
	store: Store;
	actor: string;
	tick: () => string;
}

/** Each factory owns only memory; operations return detached typed snapshots. */
export function createMemoryBeads(options: MemoryBeadsOptions = {}): BeadsService {
	const stores = new Map<string, Store>();
	const select = (scope: BeadsScope): Operation => {
		const db = scope.db ?? options.db ?? "memory";
		let selected = stores.get(db);
		if (!selected) {
			selected = {
				now: options.now ?? (() => EPOCH),
				issues: new Map(),
				comments: [],
				edges: [],
				queries: new Map(),
				sequence: ZERO,
				revision: ZERO,
			};
			stores.set(db, selected);
		}
		const store = selected;
		return {
			store,
			actor: scope.actor ?? options.actor ?? "memory",
			tick: () => {
				store.revision = Math.max(store.revision + ONE, Date.parse(store.now()));
				return new Date(store.revision).toISOString();
			},
		};
	};
	return {
		create: (scope, input) => resolveMemory(() => createIssue(select(scope), input)),
		show: (scope, id) =>
			resolveMemory(() => {
				const { store } = select(scope);
				return hydrate(store, getIssue(store, id, "show"));
			}),
		showMany: (scope, ids) =>
			resolveMemory(() => {
				const { store } = select(scope);
				return ids.map((id) => hydrate(store, getIssue(store, id, "show")));
			}),
		list: (scope, selection = {}) =>
			resolveMemory(() => listIssues(select(scope).store, selection)),
		search: (scope, text, selection = {}) =>
			resolveMemory(() => searchIssues(select(scope).store, text, selection)),
		ready: (scope, selection = {}) =>
			resolveMemory(() => readyIssues(select(scope).store, selection)),
		update: (scope, ids, input) => resolveMemory(() => updateIssues(select(scope), ids, input)),
		close: (scope, id, input = {}) => resolveMemory(() => closeIssue(select(scope), id, input)),
		where: (scope) =>
			resolveMemory(() => {
				const db = scope.db ?? options.db ?? "memory";
				return { database_path: db };
			}),
		comments: {
			add: (scope, id, text) => resolveMemory(() => addComment(select(scope), id, text)),
			list: (scope, id) =>
				resolveMemory(() => {
					const { store } = select(scope);
					getIssue(store, id, "comments");
					return structuredClone(store.comments.filter((comment) => comment.issue_id === id));
				}),
		},
		dep: {
			add: (scope, id, dependsOn, type = "blocks") =>
				resolveMemory(() => addDependency(select(scope), id, dependsOn, type)),
			remove: (scope, id, dependsOn, type) =>
				resolveMemory(() => removeDependency(select(scope), id, dependsOn, type)),
		},
		query: {
			save: (scope, name, selection, description) =>
				resolveMemory(() => saveQuery(select(scope), name, selection, description)),
			list: (scope) =>
				resolveMemory(() => {
					const { store } = select(scope);
					return {
						queries: [...store.queries.values()]
							.toSorted((left, right) => {
								if (left.name < right.name) {
									return -ONE;
								}
								if (left.name > right.name) {
									return ONE;
								}
								return ZERO;
							})
							.map(({ selection: _selection, ...query }) => structuredClone(query)),
						count: store.queries.size,
					};
				}),
			run: (scope, name, overrides = {}) =>
				resolveMemory(() => {
					const { store } = select(scope);
					const query = getQuery(store, name);
					return listIssues(store, mergeQuerySelection(query.selection, overrides));
				}),
			delete: (scope, name) =>
				resolveMemory(() => {
					const { store } = select(scope);
					getQuery(store, name);
					store.queries.delete(name);
					return { status: "ok", name, action: "deleted" };
				}),
		},
		sync: {
			import: unsupportedSync,
			flush: unsupportedSync,
			merge: unsupportedSync,
			status: unsupportedSync,
		},
	};
}

// --- Private functions ---
// eslint-disable-next-line require-await -- Memory operations expose the same rejection boundary as native I/O.
async function resolveMemory<Result>(operation: () => Result): Promise<Result> {
	return operation();
}
function unsupportedSync(): Promise<never> {
	return Promise.reject(new Error("Memory Beads cannot synchronize filesystem state"));
}
function createIssue(op: Operation, unparsed: CreateBead): CreatedBead {
	const { store, actor, tick } = op;
	const input = parseDates(store, unparsed);
	if (input.parent) {
		getIssue(store, input.parent, "create");
	}
	for (const dep of input.deps ?? []) {
		getIssue(store, dep.id, "create");
	}
	store.sequence += ONE;
	let id = `mem-${store.sequence}`;
	if (input.parent) {
		id = `${input.parent}.${store.sequence}`;
	}
	const timestamp = tick();
	const issue: Issue = {
		id,
		title: input.title,
		description: "",
		issue_type: input.type ?? "task",
		priority: input.priority ?? DEFAULT_PRIORITY,
		status: input.status ?? "open",
		created_by: actor,
		created_at: timestamp,
		updated_at: timestamp,
		labels: replacementLabels(input.labels ?? [], "create"),
		notes: "",
		design: "",
		acceptance_criteria: "",
	};
	applyFields(issue, input);
	if (issue.status === "closed") {
		issue.closed_at = timestamp;
	}
	store.issues.set(id, issue);
	if (input.parent) {
		store.edges.push({ source: id, target: input.parent, type: "parent-child" });
	}
	for (const dep of input.deps ?? []) {
		if (
			!store.edges.some(
				(edge) => edge.source === id && edge.target === dep.id && edge.type === dep.type,
			)
		) {
			store.edges.push({ source: id, target: dep.id, type: dep.type });
		}
	}
	return structuredClone(issue);
}
function updateIssues(
	op: Operation,
	ids: readonly string[],
	unparsed: UpdateBead,
): BeadUpdateReceipt[] {
	const { store, actor, tick } = op;
	const input = parseDates(store, unparsed);
	if (input.status === "closed" || input.status === "tombstone") {
		validation(
			"update",
			"status",
			`terminal status ${input.status} requires its dedicated command`,
		);
	}
	if (input.ifUnchanged !== undefined && ids.length !== ONE) {
		validation("update", "if-unchanged", "requires exactly one issue ID");
	}
	const issues = ids.map((id) => getIssue(store, id, "update"));
	if (input.parent) {
		getIssue(store, input.parent, "update");
		for (const id of ids) {
			validateParent(store, id, input.parent);
		}
	}
	if (input.appendNotes !== undefined && !input.appendNotes.trim()) {
		validation("update", "append-notes", "text to append must not be empty");
	}
	if (input.ifUnchanged !== undefined && timestampInstant(input.ifUnchanged) === undefined) {
		validation("update", "if-unchanged", "requires an RFC3339 timestamp");
	}
	for (const label of [...(input.addLabels ?? []), ...(input.removeLabels ?? [])]) {
		validateLabel(label, "update");
	}
	let labels: string[] | undefined = undefined;
	if (input.setLabels !== undefined || input.labels !== undefined) {
		labels = replacementLabels([...(input.labels ?? []), ...(input.setLabels ?? [])], "update");
	}
	for (const issue of issues) {
		validateOverwrite(issue, input);
		if (
			input.ifUnchanged !== undefined &&
			timestampInstant(issue.updated_at) !== timestampInstant(input.ifUnchanged)
		) {
			fail(
				"update",
				CONFLICT,
				"UPDATE_PRECONDITION_FAILED",
				`${issue.id} changed since you read it. Nothing was written.`,
			);
		}
		if (input.claim) {
			if (issue.assignee && issue.assignee !== actor) {
				validation("update", "claim", `issue ${issue.id} already assigned to ${issue.assignee}`);
			}
			if (issue.status === "closed") {
				validation("update", "claim", `cannot claim closed issue ${issue.id}`);
			}
			if (isDeferred(store, issue)) {
				validation("update", "claim", `cannot claim deferred issue ${issue.id}`);
			}
		}
		if ((input.claim || input.status === "in_progress") && !input.force) {
			const blockers = blockingIssues(store, issue.id);
			if (blockers.length > ZERO) {
				validation("update", "claim", `cannot claim blocked issue: ${blockers.join(", ")}`);
			}
		}
	}
	return issues.map((issue) => {
		const before = JSON.stringify(issue);
		const edges = JSON.stringify(store.edges);
		const fieldsWritten = applyFields(issue, input);
		if (input.status !== undefined && issue.status !== "closed") {
			delete issue.closed_at;
			delete issue.close_reason;
		}
		if (input.claim) {
			issue.assignee = actor;
			issue.status = "in_progress";
		}
		const addedLabels = [...new Set([...issue.labels, ...(input.addLabels ?? [])])].toSorted();
		const labelsWritten =
			JSON.stringify(addedLabels) !== JSON.stringify(issue.labels) ||
			input.removeLabels?.some((label) => addedLabels.includes(label));
		issue.labels = addedLabels.filter((label) => !input.removeLabels?.includes(label)).toSorted();
		if (labels !== undefined) {
			issue.labels = [...labels];
		}
		if (input.appendNotes !== undefined && !notesEndWithBlock(issue.notes, input.appendNotes)) {
			if (issue.notes && !issue.notes.endsWith("\n")) {
				issue.notes += "\n";
			}
			issue.notes += input.appendNotes;
		}
		if (
			input.parent !== undefined &&
			(store.edges.find((edge) => edge.source === issue.id && edge.type === "parent-child")
				?.target ?? "") !== input.parent
		) {
			store.edges = store.edges.filter(
				(edge) => edge.source !== issue.id || edge.type !== "parent-child",
			);
			if (input.parent) {
				store.edges.push({ source: issue.id, target: input.parent, type: "parent-child" });
			}
		}
		if (
			fieldsWritten ||
			input.claim ||
			labelsWritten ||
			before !== JSON.stringify(issue) ||
			edges !== JSON.stringify(store.edges)
		) {
			issue.updated_at = tick();
		}
		return {
			id: issue.id,
			title: issue.title,
			status: issue.status,
			priority: issue.priority,
			assignee: issue.assignee ?? null,
			owner: issue.owner ?? null,
			updated_at: issue.updated_at,
		};
	});
}
function closeIssue(
	op: Operation,
	id: string,
	input: { reason?: string | undefined; force?: boolean | undefined },
): BeadCloseReceipt[] {
	const { store, tick } = op;
	const issue = store.issues.get(id);
	if (!issue) {
		fail("close", NOT_FOUND, "ISSUE_NOT_FOUND", `Issue not found: ${id}`);
	}
	if (issue.status === "closed") {
		closeSkipped(id, "already closed");
	}
	if (!input.force) {
		const blockers = directBlockingIssues(store, id);
		if (blockers.length > ZERO) {
			closeSkipped(
				id,
				`blocked by: ${blockers.join(", ")} — close the open blocker(s) first, or use --force to close anyway`,
			);
		}
		const children = activeChildren(store, issue);
		if (children.length > ZERO) {
			const total = store.edges.filter(
				(edge) => edge.target === id && edge.type === "parent-child",
			).length;
			closeSkipped(
				id,
				`parent issue has ${children.length}/${total} open children (use --force to close anyway)`,
			);
		}
	}
	issue.status = "closed";
	issue.closed_at = tick();
	issue.updated_at = issue.closed_at;
	issue.close_reason = input.reason ?? "done";
	return [
		{
			id,
			title: issue.title,
			status: issue.status,
			closed_at: issue.closed_at,
			close_reason: issue.close_reason,
		},
	];
}
function addComment(op: Operation, id: string, text: string): BeadComment {
	const { store, actor, tick } = op;
	const issue = getIssue(store, id, "comments");
	if (!text.trim()) {
		validation("comments", "text", "comment must not be empty");
	}
	const comment = {
		id: store.comments.length + ONE,
		issue_id: id,
		author: actor,
		text,
		created_at: tick(),
	};
	store.comments.push(comment);
	issue.updated_at = tick();
	return { ...comment };
}
function addDependency(
	op: Operation,
	source: string,
	target: string,
	type: string,
): DependencyReceipt {
	const { store, tick } = op;
	const issue = getIssue(store, source, "dep");
	getIssue(store, target, "dep");
	if (source === target) {
		fail("dep", CYCLE, "SELF_DEPENDENCY", "Cannot depend on self");
	}
	const existing = store.edges.some(
		(edge) => edge.source === source && edge.target === target && edge.type === type,
	);
	if (existing) {
		return dependencyReceipt(source, target, type, "already_exists");
	}
	if (BLOCKING_TYPES.has(type) && dependencyPath(store, target, source)) {
		fail("dep", CYCLE, "CYCLE_DETECTED", `Dependency cycle detected: ${source} -> ${target}`);
	}
	store.edges.push({ source, target, type });
	issue.updated_at = tick();
	return dependencyReceipt(source, target, type, "added");
}
function removeDependency(
	op: Operation,
	source: string,
	target: string,
	type?: string,
): DependencyReceipt {
	const { store, tick } = op;
	const issue = getIssue(store, source, "dep");
	getIssue(store, target, "dep");
	const matches = store.edges.filter(
		(edge) =>
			edge.source === source &&
			edge.target === target &&
			(type === undefined || edge.type === type),
	);
	if (matches.length > ONE) {
		validation("dep", "dep_type", "multiple dependency types require an explicit type");
	}
	const selectedType = type ?? matches[ZERO]?.type ?? "blocks";
	if (matches.length === ZERO) {
		return dependencyReceipt(source, target, selectedType, "not_found");
	}
	store.edges = store.edges.filter((edge) => !matches.includes(edge));
	issue.updated_at = tick();
	return dependencyReceipt(source, target, selectedType, "removed");
}
function dependencyReceipt(
	source: string,
	target: string,
	type: string,
	action: DependencyReceipt["action"],
): DependencyReceipt {
	let status = "ok";
	if (action === "already_exists") {
		status = "exists";
	} else if (action === "not_found") {
		status = "not_found";
	}
	return { status, issue_id: source, depends_on_id: target, type, action };
}
function saveQuery(
	op: Operation,
	name: string,
	selection: BeadSelection,
	description?: string,
): QueryReceipt {
	const { store, tick } = op;
	if (store.queries.has(name)) {
		validation("query", "name", `Query '${name}' already exists. Delete it first to replace.`);
	}
	const query: Query = { name, created_at: tick(), selection: structuredClone(selection) };
	if (description !== undefined) {
		query.description = description;
	}
	store.queries.set(name, query);
	return { status: "ok", name, action: "saved" };
}
function mergeQuerySelection(saved: BeadSelection, input: BeadSelection): BeadSelection {
	const overrides = { ...input };
	for (const key of Object.keys(overrides) as (keyof BeadSelection)[]) {
		const value = overrides[key];
		if (value === undefined || value === false || (Array.isArray(value) && value.length === ZERO)) {
			delete overrides[key];
		}
	}
	const merged = { ...saved, ...overrides };
	if (overrides.assignee !== undefined || overrides.unassigned) {
		merged.assignee = overrides.assignee;
		merged.unassigned = overrides.unassigned ?? false;
	}
	return merged;
}
function getQuery(store: Store, name: string): Query {
	const query = store.queries.get(name);
	if (!query) {
		validation("query", "query", `Query '${name}' not found`);
	}
	return query;
}
function listIssues(store: Store, selection: BeadSelection): BeadPage {
	const selected = filterIssues(store, selection);
	const issues = sortIssues(selected, selection.sort ?? "priority", "list", selection.reverse);
	const offset = selection.offset ?? ZERO;
	const limit = selection.limit ?? ZERO;
	return {
		issues: paginate(issues, offset, limit).map((issue) => project(issue)),
		total: issues.length,
		offset,
		limit,
		has_more: offset + paginate(issues, offset, limit).length < issues.length,
	};
}
function searchIssues(store: Store, text: string, selection: BeadSelection): BeadSearchPage {
	const term = text.toLowerCase();
	const matches = (issue: Issue) =>
		[
			issue.id,
			issue.title,
			issue.description,
			...store.comments
				.filter((comment) => comment.issue_id === issue.id)
				.map((comment) => comment.text),
		].some((content) => content.toLowerCase().includes(term));
	const candidates = filterIssues(store, selection).filter((issue) => matches(issue));
	const issues = sortIssues(candidates, selection.sort ?? "priority", "search", selection.reverse);
	const offset = selection.offset ?? ZERO;
	const limit = selection.limit ?? SEARCH_LIMIT;
	let hiddenClosed = ZERO;
	if (
		!selection.all &&
		!selection.status?.some((status) => status === "all" || status === "closed")
	) {
		hiddenClosed = filterIssues(store, { ...selection, status: ["closed"], all: true }).filter(
			(issue) => issue.status === "closed" && matches(issue),
		).length;
	}
	return {
		issues: paginate(issues, offset, limit).map((issue) => project(issue)),
		hidden_closed_count: hiddenClosed,
		offset,
		limit,
		has_more: offset + paginate(issues, offset, limit).length < issues.length,
	};
}
function singleFilter<Value>(value: Value | undefined): Value[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return [value];
}
function readyIssues(store: Store, selection: ReadySelection): ReadyBead[] {
	const issues = filterIssues(store, {
		assignee: selection.assignee,
		unassigned: selection.unassigned,
		labels: selection.labels,
		labelAny: selection.labelAny,
		priority: singleFilter(selection.priority),
		type: singleFilter(selection.type),
	}).filter(
		(issue) =>
			(issue.status === "open" || (selection.includeDeferred && issue.status === "deferred")) &&
			(selection.includeDeferred || !isDeferred(store, issue)) &&
			blockingIssues(store, issue.id).length === ZERO &&
			(issue.issue_type !== "epic" || activeChildren(store, issue).length === ZERO) &&
			(selection.parent === undefined ||
				store.edges.some(
					(edge) =>
						edge.source === issue.id &&
						edge.target === selection.parent &&
						edge.type === "parent-child",
				)),
	);
	return paginate(
		sortIssues(issues, selection.sort ?? "hybrid", "ready"),
		ZERO,
		selection.limit ?? ZERO,
	).map(({ id, title, issue_type, status, priority, created_at, updated_at, labels }) => ({
		id,
		title,
		issue_type,
		status,
		priority,
		created_at,
		updated_at,
		labels: [...labels],
	}));
}
function filterIssues(store: Store, selection: BeadSelection): Issue[] {
	return [...store.issues.values()].filter((issue) => {
		if (
			selection.status?.length &&
			!selection.status.includes("all") &&
			!selection.status.includes(issue.status)
		) {
			return false;
		}
		if (!selection.status?.length && !selection.all && issue.status === "closed") {
			return false;
		}
		if (selection.ids?.length && !selection.ids.includes(issue.id)) {
			return false;
		}
		if (selection.type?.length && !selection.type.includes(issue.issue_type)) {
			return false;
		}
		if (selection.priority?.length && !selection.priority.includes(issue.priority)) {
			return false;
		}
		if (selection.assignee !== undefined && selection.assignee !== issue.assignee) {
			return false;
		}
		if (selection.unassigned && issue.assignee) {
			return false;
		}
		if (!selection.labels?.every((label) => issue.labels.includes(label)) && selection.labels) {
			return false;
		}
		if (
			selection.labelAny?.length &&
			!selection.labelAny.some((label) => issue.labels.includes(label))
		) {
			return false;
		}
		if (selection.excludeLabels?.some((label) => issue.labels.includes(label))) {
			return false;
		}
		for (const [value, content] of [
			[selection.titleContains, issue.title],
			[selection.descriptionContains, issue.description],
			[selection.notesContains, issue.notes],
		]) {
			if (value && !content!.toLowerCase().includes(value.toLowerCase())) {
				return false;
			}
		}
		return true;
	});
}
function sortIssues(issues: Issue[], sort: string, command: string, reverse?: boolean): Issue[] {
	issues.sort((left, right) => {
		if (sort === "priority") {
			let dates = right.created_at.localeCompare(left.created_at);
			if (command === "ready") {
				dates = -dates;
			}
			return left.priority - right.priority || dates || left.id.localeCompare(right.id);
		}
		if (sort === "hybrid") {
			return (
				Number(left.priority > ONE) - Number(right.priority > ONE) ||
				left.created_at.localeCompare(right.created_at)
			);
		}
		if (sort === "oldest") {
			return left.created_at.localeCompare(right.created_at);
		}
		if (sort === "created_at" || sort === "updated_at") {
			return right[sort].localeCompare(left[sort]);
		}
		return (
			left.title.toLowerCase().localeCompare(right.title.toLowerCase()) ||
			left.id.localeCompare(right.id)
		);
	});
	if (reverse) {
		issues.reverse();
	}
	return issues;
}
function paginate(issues: Issue[], offset: number, limit: number): Issue[] {
	let end: number | undefined = undefined;
	if (limit > ZERO) {
		end = offset + limit;
	}
	return issues.slice(offset, end);
}
function project(issue: Issue): BeadRow {
	return structuredClone(issue);
}
function hydrate(store: Store, issue: Issue): BeadRecord {
	const related = (edge: Edge, id: string) => {
		const other = store.issues.get(id)!;
		return {
			id,
			title: other.title,
			status: other.status,
			priority: other.priority,
			issue_type: other.issue_type,
			dependency_type: edge.type,
		};
	};
	return structuredClone({
		...issue,
		dependencies: store.edges
			.filter((edge) => edge.source === issue.id)
			.map((edge) => related(edge, edge.target)),
		dependents: store.edges
			.filter((edge) => edge.target === issue.id)
			.map((edge) => related(edge, edge.source)),
		comments: store.comments.filter((comment) => comment.issue_id === issue.id),
	});
}
function applyFields(
	issue: Issue,
	input: Partial<CreateBead> & Pick<UpdateBead, "notes" | "design">,
): boolean {
	let written = false;
	for (const [key, field] of [
		["title", "title"],
		["description", "description"],
		["status", "status"],
		["type", "issue_type"],
		["assignee", "assignee"],
		["owner", "owner"],
		["notes", "notes"],
		["design", "design"],
		["acceptanceCriteria", "acceptance_criteria"],
		["defer", "defer_until"],
		["due", "due_at"],
	] as const) {
		const next = input[key];
		if (next !== undefined) {
			written = true;
			if (
				next === "" &&
				(field === "assignee" || field === "owner" || field === "defer_until" || field === "due_at")
			) {
				delete issue[field];
			} else {
				issue[field] = next;
			}
		}
	}
	if (input.priority !== undefined) {
		written = true;
		issue.priority = input.priority;
	}
	return written;
}
function validateOverwrite(issue: Issue, input: UpdateBead): void {
	if (input.force) {
		return;
	}
	for (const [key, field] of [
		["description", "description"],
		["design", "design"],
		["acceptanceCriteria", "acceptance_criteria"],
		["notes", "notes"],
	] as const) {
		const next = input[key];
		if (next !== undefined && issue[field] && next.length < issue[field].length / HALF) {
			validation(
				"update",
				"update",
				`${issue.id}: refusing to overwrite non-empty '${field}' without --force`,
			);
		}
	}
}
function replacementLabels(labels: readonly string[], command: string): string[] {
	const replacement = [
		...new Set(
			labels
				.flatMap((label) => label.split(","))
				.map((label) => label.trim())
				.filter(Boolean),
		),
	].toSorted();
	for (const label of replacement) {
		validateLabel(label, command);
	}
	return replacement;
}
function parseDates<Input extends Partial<CreateBead>>(store: Store, input: Input): Input {
	const fields = { ...input };
	if (fields.defer !== undefined && fields.defer !== "") {
		fields.defer = parseDate(store, fields.defer);
	}
	if (fields.due !== undefined && fields.due !== "") {
		fields.due = parseDate(store, fields.due);
	}
	return fields;
}
function parseDate(store: Store, value: string): string {
	const text = value.trim().replace(/(?<offset>[+-]\d\d:\d\d):00$/u, "$<offset>");
	const instant = timestampInstant(text);
	if (instant !== undefined) {
		return formatInstant(instant);
	}
	const relative = /^(?<amount>[+-]\d+)(?<unit>[mhdw])$/u.exec(text);
	if (relative) {
		const date = new Date(
			Date.parse(store.now()) +
				Number(relative.groups!.amount) * RELATIVE_UNITS.get(relative.groups!.unit!)!,
		);
		if (!Number.isFinite(date.getTime())) {
			validation("date", "date", "relative duration is out of supported range");
		}
		return date.toISOString();
	}
	if (/^\d{4}-\d\d-\d\d$/u.test(text)) {
		const date = new Date(`${text}T09:00:00`);
		if (Number.isFinite(date.getTime())) {
			return date.toISOString();
		}
	}
	const date = new Date(store.now());
	let days = ZERO;
	switch (text.toLowerCase()) {
		case "today": {
			days = ZERO;
			break;
		}
		case "yesterday": {
			days = -ONE;
			break;
		}
		case "tomorrow": {
			days = ONE;
			break;
		}
		case "next-week":
		case "nextweek": {
			days = NEXT_WEEK_DAYS;
			break;
		}
		default: {
			return validation("date", "date", "invalid time format");
		}
	}
	date.setDate(date.getDate() + days);
	let hour = MORNING_HOUR;
	if (text.toLowerCase() === "today") {
		hour = EVENING_HOUR;
	}
	date.setHours(hour, ZERO, ZERO, ZERO);
	return date.toISOString();
}
function timestampInstant(value: string): bigint | undefined {
	const text = value.trim();
	const match = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(?<fraction>\d+))?(?:Z|[+-]\d\d:\d\d)$/iu.exec(
		text,
	);
	const millis = Date.parse(text);
	if (!match || !Number.isFinite(millis)) {
		return undefined;
	}
	const nanos = (match.groups?.fraction ?? "")
		.padEnd(NANOS_PRECISION, "0")
		.slice(ZERO, NANOS_PRECISION);
	return BigInt(Math.floor(millis / MILLIS_PER_SECOND)) * NANOS_PER_SECOND + BigInt(nanos);
}
function formatInstant(instant: bigint): string {
	let seconds = instant / NANOS_PER_SECOND;
	let nanos = instant % NANOS_PER_SECOND;
	if (nanos < ZERO_NANOS) {
		seconds -= ONE_SECOND;
		nanos += NANOS_PER_SECOND;
	}
	const whole = new Date(Number(seconds) * MILLIS_PER_SECOND).toISOString().split(".")[ZERO]!;
	let fraction = nanos.toString().padStart(NANOS_PRECISION, "0");
	while (fraction.endsWith("000")) {
		fraction = fraction.slice(ZERO, -FRACTION_GROUP_SIZE);
	}
	if (fraction) {
		return `${whole}.${fraction}Z`;
	}
	return `${whole}Z`;
}
function validateLabel(label: string, command: string): void {
	if (!/^[A-Za-z0-9_:-]{1,50}$/u.test(label)) {
		validation(command, "label", "invalid label characters or length");
	}
}
function notesEndWithBlock(notes: string, block: string): boolean {
	if (!notes.endsWith(block)) {
		return false;
	}
	const head = notes.slice(ZERO, notes.length - block.length);
	return !head || head.endsWith("\n");
}
function validateParent(store: Store, id: string, parent: string): void {
	if (id === parent) {
		fail("update", CYCLE, "SELF_DEPENDENCY", "Cannot depend on self");
	}
	if (dependencyPath(store, id, parent)) {
		fail("update", CYCLE, "CYCLE_DETECTED", "Parent cycle detected");
	}
}
function isDeferred(store: Store, issue: Issue): boolean {
	return (
		issue.status === "deferred" ||
		Boolean(issue.defer_until && Date.parse(issue.defer_until) > Date.parse(store.now()))
	);
}
function getIssue(store: Store, id: string, command: string): Issue {
	const issue = store.issues.get(id);
	if (!issue) {
		fail(command, NOT_FOUND, "ISSUE_NOT_FOUND", `Issue not found: ${id}`);
	}
	return issue;
}
function blockingIssues(store: Store, id: string): string[] {
	const visited = new Set<string>();
	const visit = (source: string): string[] => {
		if (visited.has(source)) {
			return [];
		}
		visited.add(source);
		return store.edges
			.filter((edge) => edge.source === source)
			.flatMap((edge) => {
				if (edge.type === "parent-child") {
					return visit(edge.target);
				}
				if (BLOCKING_TYPES.has(edge.type) && store.issues.get(edge.target)!.status !== "closed") {
					return [edge.target];
				}
				return [];
			});
	};
	return visit(id);
}
function directBlockingIssues(store: Store, id: string): string[] {
	return store.edges
		.filter(
			(edge) =>
				edge.source === id &&
				BLOCKING_TYPES.has(edge.type) &&
				store.issues.get(edge.target)!.status !== "closed",
		)
		.map((edge) => edge.target);
}
function activeChildren(store: Store, issue: Issue): Issue[] {
	return store.edges
		.filter((edge) => edge.target === issue.id && edge.type === "parent-child")
		.map((edge) => store.issues.get(edge.source)!)
		.filter((child) => child.status !== "closed");
}
function dependencyPath(store: Store, start: string, target: string): boolean {
	const visited = new Set<string>();
	const visit = (id: string): boolean => {
		if (id === target) {
			return true;
		}
		if (visited.has(id)) {
			return false;
		}
		visited.add(id);
		return store.edges.some((edge) => {
			if (BLOCKING_TYPES.has(edge.type) && edge.source === id) {
				return visit(edge.target);
			}
			if (edge.type === "parent-child" && edge.target === id) {
				return visit(edge.source);
			}
			return false;
		});
	};
	return visit(start);
}
function validation(command: string, field: string, message: string): never {
	return fail(
		command,
		VALIDATION,
		"VALIDATION_FAILED",
		`Validation failed: ${field}: ${message}`,
		field,
	);
}
// eslint-disable-next-line max-params -- Native diagnostics carry command, status, code, message and optional field.
function fail(
	command: string,
	code: number,
	nativeCode: string,
	message: string,
	field?: string,
): never {
	const error: { code: string; message: string; context?: { field: string } } = {
		code: nativeCode,
		message,
	};
	if (field !== undefined) {
		error.context = { field };
	}
	throw new CommandError(`br ${command}`, { code, stderr: "", stdout: JSON.stringify({ error }) });
}
function closeSkipped(id: string, reason: string): never {
	const receipt = { closed: [], skipped: [{ id, reason }] };
	const diagnostic = {
		error: {
			code: "NOTHING_TO_DO",
			message: `Nothing to do: all 1 issue(s) skipped — ${id}: ${reason}`,
		},
	};
	throw new CommandError("br close", {
		code: NOT_FOUND,
		stderr: "",
		stdout: `${JSON.stringify(receipt)}\n${JSON.stringify(diagnostic)}`,
	});
}
