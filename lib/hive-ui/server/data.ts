import type {
	BeadFilter,
	Bee,
	Board,
	BoardFilter,
	BoardScope,
	Card,
	Colony,
	Detail,
	Hierarchy,
	InventoryFilter,
	MergeLink,
	Provenance,
	RequestInventory,
} from "../contracts.ts";
/* eslint-disable unicorn/no-null -- API contracts represent absent recorded facts explicitly. */
import type {
	BeadRecord,
	BeadSelection,
	BeadsScope,
	BeadsService,
	SelectedBead,
} from "@hive/beads";
import {
	COLONY_OBSERVATION_PREFIX,
	latestColonyObservation,
	latestStdoutActivity,
	readSpawnRequestAttribution,
	requestNeedsAttention,
	requestOutcome,
} from "@hive/shared";
import { PAGE_SIZE, RELATION_LIMIT, REQUEST_PAGE_SIZE } from "../contracts.ts";
import { SUMMARY_FIELDS, readHierarchy } from "./hierarchy.ts";
import { beadFamilies, branchRows } from "../hierarchy.ts";
import type { ReadTopology } from "./topology.ts";
import type { SummaryBead } from "./hierarchy.ts";
import { formatBeadsQuery } from "@hive/beads";
import { mergeLink } from "./merges.ts";
import { taskSelection } from "./query.ts";
import { z } from "zod";

const MAX_REQUESTS = 100;
const TASK_MATCH_BATCH = 100;
const METADATA_READ_BATCH = 100;
const MAX_ANCESTORS = 8;
const REQUEST_PARENT_CONCURRENCY = 4;
const INVENTORY_TTL_MS = 10_000;
// Read only the published identity index, independent of Busy Bee actor-state internals.
const workflowVisitSchema = z.object({ bead: z.string() });
const workflowSystemSchema = z.object({
	id: z.string(),
	created: z.array(workflowVisitSchema),
});
type Inventory = Extract<RequestInventory, { kind: "loaded" }>;
interface SourceSnapshot<Value> {
	/** Native lookup start, used to satisfy a refresh cutoff independently of response completion. */
	startedAt: number;
	/** Cached source value. */
	value: Value;
	/** Monotonic source-read version, preserved on cache hits. */
	version: number;
}
interface WorkflowIdentity {
	/** Native checkpoint revision used to reuse its parsed public identities. */
	updatedAt: string;
	/** Owning run published by this workflow system bead. */
	runId: string;
	/** Run, visit and grouping bead IDs published by this workflow system bead. */
	beadIds: string[];
}
interface ReadContext {
	/** Injected tracker reads for this endpoint. */
	beads: BeadsService;
	/** Server-selected diagnostics sink; machine mode uses a file. */
	log: (sample: object) => Promise<void>;
	/** Explicit startup allowlist entry, not a browser-supplied filesystem path. */
	colony: Colony;
	/** Correlates HTTP and native command timings. */
	requestId: string;
}

/** Compose native reads with injected topology and cache snapshots by endpoint and scope. */
// eslint-disable-next-line max-statements -- Compose independent primary resources and optional metadata caches.
export function createBoardData(readTopology: ReadTopology, now: () => number = Date.now) {
	let version = 0;
	const observe = () => {
		version = Math.max(now(), version + 1);
		return version;
	};
	// A refresh cutoff is shared by its inventory, board and detail requests. Zero uses the normal TTL.
	const inventories = new Map<string, SourceSnapshot<Inventory>>();
	const pendingInventories = new Map<string, Promise<Inventory>>();
	const parentReads = new WeakMap<Inventory, Promise<Inventory["requestParents"]>>();
	const workflowIndexes = new Map<string, Map<string, WorkflowIdentity>>();
	const workflows = cachedRead((context) => workflowRuns(context, workflowIndexes), observe, now);
	const merges = cachedRead(taskMerges, observe, now);
	// Annotations reuse summaries only within their refresh cutoff and the ten-second window.
	let summarySequence = 0;
	const summaryFences = new Map<string, number>();
	const summaryRows = new Map<
		string,
		{ startedAt: number; sequence: number; value: SummaryBead }
	>();
	// eslint-disable-next-line max-statements -- Preserve native read-start ordering and invalidate failed observations.
	const readSummaries: typeof summaries = async (context, selection, text) => {
		const startedAt = now();
		const sequence = ++summarySequence;
		let rows: SummaryBead[] = [];
		try {
			rows = await summaries(context, selection, text);
		} catch (error) {
			summaryFences.set(context.colony.id, summarySequence);
			for (const key of summaryRows.keys()) {
				if (key.startsWith(`${context.colony.id}/`)) {
					summaryRows.delete(key);
				}
			}
			throw error;
		}
		if (sequence <= (summaryFences.get(context.colony.id) ?? 0)) {
			return rows;
		}
		for (const [key, entry] of summaryRows) {
			if (startedAt - entry.startedAt >= INVENTORY_TTL_MS) {
				summaryRows.delete(key);
			}
		}
		for (const row of rows) {
			const key = `${context.colony.id}/${row.id}`;
			const previous = summaryRows.get(key);
			if (previous === undefined || previous.sequence < sequence) {
				summaryRows.set(key, { startedAt, sequence, value: row });
			}
		}
		return rows;
	};
	const branches = new Map<string, { startedAt: number; value: Hierarchy }>();
	const pendingBranches = new Map<string, Promise<Hierarchy>>();
	// eslint-disable-next-line max-statements -- Coalesce endpoint reads while retaining the original source freshness.
	const inventory = async (
		context: ReadContext,
		scope: BoardScope,
		refreshAfter: number,
	): Promise<SourceSnapshot<RequestInventory>> => {
		if (scope.view === "beads") {
			return { value: { kind: "not_requested" }, startedAt: 0, version: 0 };
		}
		const key = JSON.stringify([context.colony.id, scope.view, scope.requestPage]);
		const active = pendingInventories.get(key);
		if (active) {
			await active;
			return inventory(context, scope, refreshAfter);
		}
		const existing = inventories.get(key);
		if (
			existing &&
			existing.startedAt >= refreshAfter &&
			now() - existing.startedAt < INVENTORY_TTL_MS
		) {
			return existing;
		}
		const startedAt = now();
		const sourceVersion = observe();
		const pending = readInventory(context, scope);
		pendingInventories.set(key, pending);
		try {
			const value = await pending;
			const result = { startedAt, value, version: sourceVersion };
			inventories.set(key, result);
			return result;
		} catch (error) {
			inventories.delete(key);
			throw error;
		} finally {
			pendingInventories.delete(key);
		}
	};
	const cards = async (
		context: ReadContext,
		tasks: (SummaryBead | BeadRecord)[],
		refreshAfter: number,
	): Promise<Card[]> => {
		if (tasks.length === 0) {
			return [];
		}
		const runs = await workflows(context, refreshAfter);
		return tasks.map((task) => card(task, [], runs.value.has(task.id)));
	};
	// Coalesce overlapping family reads and reuse only complete, fresh components.
	// eslint-disable-next-line max-statements
	const hierarchy = async (
		context: ReadContext,
		ids: string[],
		{ direction, refreshAfter }: { direction: "family" | "descendants"; refreshAfter: number },
	): Promise<Hierarchy> => {
		if (ids.length === 0) {
			return { nodes: [], fetchedAt: new Date().toISOString(), stale: false };
		}
		const colony = context.colony.id;
		const active = pendingBranches.get(colony);
		if (active) {
			// The previous caller owns its result; a queued scope only waits for the slot.
			await Promise.allSettled([active]);
			return hierarchy(context, ids, { direction, refreshAfter });
		}
		for (const [key, entry] of branches) {
			if (now() - Date.parse(entry.value.fetchedAt) >= INVENTORY_TTL_MS) {
				branches.delete(key);
			}
		}
		const cached = ids.map((id) => branches.get(`${colony}/${id}`));
		if (cached.every((entry) => entry !== undefined && entry.startedAt >= refreshAfter)) {
			const nodes = [
				...new Map(
					cached.flatMap((entry) => entry!.value.nodes).map((node) => [node.id, node]),
				).values(),
			];
			const value = {
				nodes,
				fetchedAt: cached.map((entry) => entry!.value.fetchedAt).toSorted()[0]!,
				stale: cached.some((entry) => entry!.value.stale),
			};
			if (direction === "descendants") {
				value.nodes = branchRows(
					value,
					nodes.find((node) => node.id === ids[0])!,
				).map(({ node }) => node);
			}
			return value;
		}
		const startedAt = now();
		const pending = readBranch(context, ids, { direction, refreshAfter });
		pendingBranches.set(colony, pending);
		try {
			const value = await pending;
			const refreshed = new Set(value.nodes.map((node) => node.id));
			// A native reparent can split/merge components: retire every alias of overlapping old families.
			for (const [key, entry] of branches) {
				if (
					key.startsWith(`${colony}/`) &&
					entry.value.nodes.some((node) => refreshed.has(node.id))
				) {
					branches.delete(key);
				}
			}
			if (direction === "family") {
				for (const family of beadFamilies(value)) {
					const branch = { ...value, nodes: family.rows.map(({ node }) => node) };
					for (const node of branch.nodes) {
						branches.set(`${colony}/${node.id}`, { startedAt, value: branch });
					}
				}
			}
			return value;
		} finally {
			pendingBranches.delete(colony);
		}
	};
	const readBranch = async (
		context: ReadContext,
		ids: string[],
		{ direction, refreshAfter }: { direction: "family" | "descendants"; refreshAfter: number },
	): Promise<Hierarchy> => {
		const result = await readTopology(context.colony, async (graph) => {
			const records = await readHierarchy(
				ids,
				{
					graph,
					rows: async (batch) => {
						const rows = await readSummaries(context, {
							ids: batch,
							all: true,
							limit: batch.length,
						});
						const found = new Set(rows.map((row) => row.id));
						const missing = batch.filter((id) => !found.has(id));
						// Exact reads retain exported templates omitted by native list.
						if (missing.length > 0) {
							const exact = await read(context, ["show", ...missing], () =>
								context.beads.showMany(readScope(context), missing),
							);
							rows.push(
								...exact.map((bead) =>
									Object.assign(bead, {
										dependency_count: bead.dependencies.length,
										dependent_count: bead.dependents.length,
									}),
								),
							);
						}
						return rows;
					},
				},
				direction,
			);
			const projected = await cards(
				context,
				records.map(({ bead }) => bead),
				refreshAfter,
			);
			return {
				nodes: projected.map((summary, index) =>
					Object.assign(summary, {
						parentIds: records[index]!.parentIds,
					}),
				),
				fetchedAt: graph.fetchedAt,
			};
		});
		return { ...result.value, stale: result.stale };
	};
	return {
		board: async (
			context: ReadContext,
			filter: BoardFilter,
			refreshAfter: number,
		): Promise<Board> => {
			const current = await inventory(context, filter, refreshAfter);
			const { tasks, query } = await readTasks(context, filter, {
				inventory: current.value,
				readSummaries,
			});
			const page = tasks.slice(0, PAGE_SIZE);
			const projected = await cards(context, page, refreshAfter);
			return {
				cards: projected,
				fetchedAt: new Date().toISOString(),
				hasMore: tasks.length > PAGE_SIZE,
				labels: [...new Set(projected.flatMap((item) => item.labels))].toSorted(),
				query,
			};
		},
		detail: async (
			context: ReadContext,
			id: string,
			{ scope, refreshAfter }: { scope: BoardScope; refreshAfter: number },
		): Promise<Detail> => {
			const [current, bead] = await Promise.all([
				inventory(context, scope, refreshAfter),
				show(context, id),
			]);
			const [base, mergeIds] = await Promise.all([
				cards(context, [bead], refreshAfter),
				mergeRelationIds(context, bead),
			]);
			const summary = base[0]!;
			let bees: Bee[] = [];
			if (current.value.kind === "loaded") {
				({ bees } = current.value);
			}
			return {
				acceptanceCriteria: bead.acceptance_criteria,
				card: {
					...summary,
					bees: bees.filter((item) => item.taskIds.includes(bead.id)),
				},
				comments: bead.comments.map((comment) => ({
					at: comment.created_at,
					author: comment.author,
					id: comment.id,
					text: comment.text,
				})),
				dependencies: relations(
					bead.dependencies.filter(
						(edge) => edge.dependency_type !== "parent-child" && !mergeIds.has(edge.id),
					),
				),
				dependents: relations(
					bead.dependents.filter(
						(edge) => edge.dependency_type !== "parent-child" && !mergeIds.has(edge.id),
					),
				),
				description: bead.description,
				design: bead.design,
				notes: bead.notes,
				fetchedAt: new Date().toISOString(),
			};
		},
		inventory: async (
			context: ReadContext,
			filter: InventoryFilter,
			refreshAfter: number,
		): Promise<RequestInventory> => {
			const current = await inventory(context, filter, refreshAfter);
			if (current.value.kind === "not_requested") {
				return current.value;
			}
			const source = current.value;
			let parents = parentReads.get(source);
			if (parents === undefined) {
				parents = (async () => {
					try {
						return await requestParents(context, source.bees);
					} catch (error) {
						parentReads.delete(source);
						throw error;
					}
				})();
				parentReads.set(source, parents);
			}
			return filterInventory(context, filter, { ...source, requestParents: await parents });
		},
		hierarchy: (context: ReadContext, ids: string[], refreshAfter: number) =>
			hierarchy(context, ids, { direction: "family", refreshAfter }),
		outline: (context: ReadContext, id: string, refreshAfter: number) =>
			hierarchy(context, [id], { direction: "descendants", refreshAfter }),
		// eslint-disable-next-line max-statements -- Join optional icons independently of primary reads.
		annotations: async (context: ReadContext, ids: string[], refreshAfter: number) => {
			if (ids.length === 0) {
				return { cards: [], fetchedAt: new Date(now()).toISOString() };
			}
			const tasks: SummaryBead[] = [];
			const missing: string[] = [];
			for (const id of ids) {
				const saved = summaryRows.get(`${context.colony.id}/${id}`);
				if (
					refreshAfter > 0 &&
					saved !== undefined &&
					saved.startedAt >= refreshAfter &&
					now() - saved.startedAt < INVENTORY_TTL_MS
				) {
					tasks.push(saved.value);
				} else {
					missing.push(id);
				}
			}
			if (missing.length > 0) {
				tasks.push(
					...(await readSummaries(context, { ids: missing, all: true, limit: missing.length })),
				);
			}
			const needsAssignments = tasks.some(
				(task) => task.status === "in_progress" && (task.assignee ?? "") !== "",
			);
			let view: BoardScope["view"] = "beads";
			if (needsAssignments) {
				view = "open";
			}
			const [references, current] = await Promise.all([
				merges(context, refreshAfter),
				inventory(context, { requestPage: 0, view }, refreshAfter),
			]);
			let assignments: Bee[] = [];
			if (current.value.kind === "loaded") {
				assignments = current.value.bees;
			}
			return {
				cards: tasks.map((task) => ({
					id: task.id,
					updatedAt: task.updated_at,
					status: task.status,
					assignee: task.assignee ?? null,
					beeAssignments: card(task, assignments, false).beeAssignments,
					merges: references.value.get(task.id) ?? [],
					sources: { merges: references.version, assignments: current.version },
				})),
				fetchedAt: new Date(now()).toISOString(),
			};
		},
		workflow: async <Value>(
			context: ReadContext,
			id: string,
			preview: (colony: Colony, runId: string) => Promise<Value>,
		): Promise<Value> => {
			let runs = await workflows(context, 0);
			if (!runs.value.has(id)) {
				runs = await workflows(context, Math.max(now(), runs.startedAt + 1));
			}
			const runId = runs.value.get(id);
			if (runId === undefined) {
				throw new Error(`Bead ${id} is not a workflow-generated record.`);
			}
			return preview(context.colony, runId);
		},
		provenance: readProvenance,
	};
}

// --- Native I/O and projections ---
/** Refresh public workflow identities, hydrating only new or changed checkpoint descriptions. */
// eslint-disable-next-line max-statements -- Publish the endpoint index only after complete enumeration and hydration.
async function workflowRuns(
	context: ReadContext,
	indexes: Map<string, Map<string, WorkflowIdentity>>,
): Promise<Map<string, string>> {
	const selection = { all: true, labels: ["system", "busybee-checkpoint"], limit: 0 };
	const fields = ["id", "updated_at"] as const;
	const { issues: systems } = await read(
		context,
		[...formatBeadsQuery(selection), "--fields", fields.join(",")],
		() => context.beads.listProjected(readScope(context), selection, fields),
	);
	const previous = indexes.get(context.colony.id) ?? new Map<string, WorkflowIdentity>();
	const current = new Map<string, WorkflowIdentity>();
	const changed: string[] = [];
	for (const system of systems) {
		const saved = previous.get(system.id);
		if (saved?.updatedAt === system.updated_at) {
			current.set(system.id, saved);
		} else {
			changed.push(system.id);
		}
	}
	const batches: BeadSelection[] = [];
	if (previous.size === 0 && changed.length > 0) {
		batches.push(selection);
	} else {
		for (let offset = 0; offset < changed.length; offset += METADATA_READ_BATCH) {
			const ids = changed.slice(offset, offset + METADATA_READ_BATCH);
			batches.push({ ...selection, ids, limit: ids.length });
		}
	}
	for (const batch of batches) {
		const columns = ["id", "updated_at", "description"] as const;
		// eslint-disable-next-line no-await-in-loop -- Serialize warm batches; cold startup uses one description read.
		const { issues } = await read(
			context,
			[...formatBeadsQuery(batch), "--fields", columns.join(",")],
			() => context.beads.listProjected(readScope(context), batch, columns),
		);
		if (issues.length !== (batch.ids?.length ?? systems.length)) {
			throw new Error("Workflow checkpoints changed while loading identities. Refresh to reload.");
		}
		for (const system of issues) {
			const workflow = workflowSystemSchema.parse(JSON.parse(system.description));
			current.set(system.id, {
				updatedAt: system.updated_at,
				runId: workflow.id,
				beadIds: [workflow.id, ...workflow.created.map((visit) => visit.bead)],
			});
		}
	}
	const beads = new Map<string, string>();
	for (const system of current.values()) {
		for (const id of system.beadIds) {
			beads.set(id, system.runId);
		}
	}
	indexes.set(context.colony.id, current);
	return beads;
}

function cachedRead<Value>(
	operation: (context: ReadContext) => Promise<Value>,
	observe: () => number,
	now: () => number,
) {
	const snapshots = new Map<string, SourceSnapshot<Value>>();
	const pending = new Map<string, Promise<Value>>();
	// eslint-disable-next-line max-statements -- Preserve source freshness while coalescing overlapping metadata reads.
	const load = async (
		context: ReadContext,
		refreshAfter: number,
	): Promise<SourceSnapshot<Value>> => {
		const key = context.colony.id;
		const active = pending.get(key);
		if (active) {
			await active;
			return load(context, refreshAfter);
		}
		const cached = snapshots.get(key);
		if (cached && cached.startedAt >= refreshAfter && now() - cached.startedAt < INVENTORY_TTL_MS) {
			return cached;
		}
		const startedAt = now();
		const sourceVersion = observe();
		const work = operation(context);
		pending.set(key, work);
		try {
			const value = await work;
			const result = { startedAt, value, version: sourceVersion };
			snapshots.set(key, result);
			return result;
		} finally {
			pending.delete(key);
		}
	};
	return load;
}

// eslint-disable-next-line max-statements -- Traverse only the label-narrowed merge set, never task detail bodies.
async function taskMerges(context: ReadContext): Promise<Map<string, MergeLink[]>> {
	const selection = { labels: ["merge"], all: true, limit: 0 };
	const fields = ["id"] as const;
	const { issues } = await read(
		context,
		[...formatBeadsQuery(selection), "--fields", fields.join(",")],
		() => context.beads.listProjected(readScope(context), selection, fields),
	);
	const merges = new Map<string, MergeLink[]>();
	for (let offset = 0; offset < issues.length; offset += METADATA_READ_BATCH) {
		const ids = issues.slice(offset, offset + METADATA_READ_BATCH).map((bead) => bead.id);
		// eslint-disable-next-line no-await-in-loop -- Bound hydration to the label-selected merge records.
		const references = await read(context, ["show", ...ids], () =>
			context.beads.showMany(readScope(context), ids),
		);
		for (const bead of references) {
			const link = mergeLink(bead);
			const related = new Set(
				[...bead.dependencies, ...bead.dependents]
					.filter((edge) => edge.dependency_type === "relates-to")
					.map((edge) => edge.id),
			);
			for (const id of related) {
				const links = merges.get(id) ?? [];
				links.push(link);
				merges.set(id, links);
			}
		}
	}
	for (const links of merges.values()) {
		links.sort((left, right) => left.id.localeCompare(right.id));
	}
	return merges;
}

/** Classify only selected native relationships; icon bodies and edges remain deferred. */
async function mergeRelationIds(context: ReadContext, bead: BeadRecord): Promise<Set<string>> {
	const ids = [
		...new Set(
			[...bead.dependencies, ...bead.dependents]
				.filter((edge) => edge.dependency_type !== "parent-child")
				.map((edge) => edge.id),
		),
	];
	const merges = new Set<string>();
	const fields = ["id"] as const;
	for (let offset = 0; offset < ids.length; offset += METADATA_READ_BATCH) {
		const batch = ids.slice(offset, offset + METADATA_READ_BATCH);
		const selection = { ids: batch, labels: ["merge"], all: true, limit: batch.length };
		// eslint-disable-next-line no-await-in-loop -- Bound classification to selected relationships.
		const { issues } = await read(
			context,
			[...formatBeadsQuery(selection), "--fields", fields.join(",")],
			() => context.beads.listProjected(readScope(context), selection, fields),
		);
		for (const issue of issues) {
			merges.add(issue.id);
		}
	}
	return merges;
}

function relations(edges: BeadRecord["dependencies"]): Detail["dependencies"] {
	return {
		items: edges.slice(0, RELATION_LIMIT).map((edge) => ({
			dependencyType: edge.dependency_type,
			id: edge.id,
			priority: edge.priority,
			status: edge.status,
			title: edge.title,
		})),
		total: edges.length,
	};
}

// eslint-disable-next-line max-statements -- Keep request membership and the exact bounded native task query together.
async function readTasks(
	context: ReadContext,
	filter: BoardFilter,
	{ inventory, readSummaries }: { inventory: RequestInventory; readSummaries: typeof summaries },
): Promise<{ tasks: SummaryBead[]; query: string[] }> {
	let taskIds: string[] = [];
	if (inventory.kind === "loaded") {
		if (filter.request === undefined) {
			return { query: [], tasks: [] };
		}
		const request =
			inventory.bees.find((item) => item.id === filter.request) ??
			bee(await show(context, filter.request));
		({ taskIds } = request);
		if (taskIds.length === 0) {
			return { query: [], tasks: [] };
		}
	}
	const selection = taskSelection(filter, taskIds, {
		limit: PAGE_SIZE + 1,
		offset: filter.page * PAGE_SIZE,
	});
	const args = [
		...formatBeadsQuery(selection, filter.query || undefined),
		"--fields",
		SUMMARY_FIELDS.join(","),
	];
	const tasks = await readSummaries(context, selection, filter.query);
	const query = [
		"br",
		...args,
		"--no-auto-import",
		"--no-auto-flush",
		"--db",
		context.colony.beadsDb,
		"--json",
	];
	return { query, tasks };
}

/** Match native task predicates across the whole candidate membership, not the visible task page. */
// Keep activation, bounded native matching and existential projection together.
// eslint-disable-next-line max-statements
async function filterInventory(
	context: ReadContext,
	filter: BeadFilter,
	inventory: RequestInventory,
): Promise<RequestInventory> {
	const hasPredicate =
		filter.query.length > 0 ||
		[filter.statuses, filter.priorities, filter.all, filter.any, filter.exclude].some(
			(values) => values.length > 0,
		);
	if (inventory.kind === "not_requested" || !hasPredicate) {
		return inventory;
	}
	const taskIds = [...new Set(inventory.bees.flatMap((request) => request.taskIds))];
	const matching = new Set<string>();
	for (let offset = 0; offset < taskIds.length; offset += TASK_MATCH_BATCH) {
		const batch = taskIds.slice(offset, offset + TASK_MATCH_BATCH);
		const selection = taskSelection(filter, batch, { limit: batch.length, offset: 0 });
		// Bound native process concurrency and argv size while covering every linked task.
		// eslint-disable-next-line no-await-in-loop
		const tasks = await summaries(context, selection, filter.query);
		for (const task of tasks) {
			matching.add(task.id);
		}
	}
	return {
		...inventory,
		bees: inventory.bees.filter((request) => request.taskIds.some((id) => matching.has(id))),
	};
}

// Native execution telemetry covers success, size and failure in one boundary.
// eslint-disable-next-line max-statements
async function read<Value>(
	context: ReadContext,
	args: string[],
	operation: () => Promise<Value>,
): Promise<Value> {
	const started = performance.now();
	let outcome = "error";
	let bytes = 0;
	let failure: string | undefined = undefined;
	try {
		const value = await operation();
		bytes = new TextEncoder().encode(JSON.stringify(value)).length;
		outcome = "ok";
		return value;
	} catch (error) {
		failure = String(error);
		throw error;
	} finally {
		const ms = Math.round(performance.now() - started);
		await context.log({
			args,
			bytes,
			colony: context.colony.id,
			failure,
			ms,
			operation: args[0],
			outcome,
			requestId: context.requestId,
			scope: "native",
		});
	}
}

function readScope(context: ReadContext): BeadsScope {
	return {
		cwd: context.colony.root,
		db: context.colony.beadsDb,
		noAutoImport: true,
		noAutoFlush: true,
	};
}

function show(context: ReadContext, id: string): Promise<BeadRecord> {
	return read(context, ["show", id], () => context.beads.show(readScope(context), id));
}

async function list(
	context: ReadContext,
	selection: BeadSelection,
	text = "",
): Promise<SelectedBead[]> {
	const page = await read<{ issues: SelectedBead[] }>(
		context,
		formatBeadsQuery(selection, text || undefined),
		() => {
			if (text) {
				return context.beads.search(readScope(context), text, selection);
			}
			return context.beads.list(readScope(context), selection);
		},
	);
	return page.issues;
}

async function summaries(
	context: ReadContext,
	selection: BeadSelection,
	text = "",
): Promise<SummaryBead[]> {
	const args = [
		...formatBeadsQuery(selection, text || undefined),
		"--fields",
		SUMMARY_FIELDS.join(","),
	];
	const page = await read<{ issues: SummaryBead[] }>(context, args, () => {
		if (text) {
			return context.beads.searchProjected(readScope(context), text, selection, SUMMARY_FIELDS);
		}
		return context.beads.listProjected(readScope(context), selection, SUMMARY_FIELDS);
	});
	return page.issues;
}

// eslint-disable-next-line max-statements -- One bounded inventory read owns scope, lookahead and native hydration.
async function readInventory(context: ReadContext, scope: BoardScope): Promise<Inventory> {
	let limit = MAX_REQUESTS;
	const selection: BeadSelection = { labels: ["system", "bee"] };
	if (scope.view === "completed") {
		limit = REQUEST_PAGE_SIZE;
		selection.all = true;
		selection.status = ["closed"];
		selection.labels = [...selection.labels!, "bee-outcome:succeeded"];
		selection.sort = "updated_at";
		selection.offset = scope.requestPage * limit;
	} else {
		selection.status = ["open"];
	}
	selection.limit = limit + 1;
	const issues = await list(context, selection);
	if (scope.view === "open" && issues.length > limit) {
		throw new Error(`Open requests exceed the ${MAX_REQUESTS}-request limit for this colony.`);
	}
	const ids = issues.slice(0, limit).map((issue) => issue.id);
	let requests: BeadRecord[] = [];
	if (ids.length > 0) {
		requests = await read(context, ["show", ...ids], () =>
			context.beads.showMany(readScope(context), ids),
		);
	}
	return {
		bees: requests.map((request) => bee(request)),
		requestParents: [],
		total: requests.length,
		hasMore: issues.length > limit,
		kind: "loaded",
		readAt: new Date().toISOString(),
	};
}

/** Resolve names across native history, independent of the visible inventory page. */
async function requestParents(
	context: ReadContext,
	requests: Bee[],
): Promise<Inventory["requestParents"]> {
	const identities = new Set(requests.map((request) => request.identity));
	const names = [
		...new Set(
			requests.flatMap((request) => {
				if (request.requester !== null && identities.has(request.requester)) {
					return [request.requester];
				}
				return [];
			}),
		),
	];
	const parents = new Map<string, string>();
	for (let start = 0; start < names.length; start += REQUEST_PARENT_CONCURRENCY) {
		// eslint-disable-next-line no-await-in-loop -- Bound concurrent native subprocesses.
		await Promise.all(
			names.slice(start, start + REQUEST_PARENT_CONCURRENCY).map(async (name) => {
				const selection = { all: true, labels: ["system", "bee"], assignee: name, limit: 2 };
				const fields = ["id"] as const;
				const { issues } = await read(
					context,
					[...formatBeadsQuery(selection), "--fields", "id"],
					() => context.beads.listProjected(readScope(context), selection, fields),
				);
				if (issues.length === 1) {
					parents.set(name, issues[0]!.id);
				}
			}),
		);
	}
	return requests.flatMap((request) => {
		if (request.requester === null) {
			return [];
		}
		const parent = parents.get(request.requester);
		if (parent === undefined) {
			return [];
		}
		return [{ parent, child: request.id }];
	});
}

function bee(bead: BeadRecord): Bee {
	const request = readSpawnRequestAttribution(bead);
	const observed = latestColonyObservation(bead);
	let observation: Bee["observation"] = null;
	if (observed) {
		observation = {
			at: observed.created_at,
			author: observed.author,
			text: observed.text.slice(COLONY_OBSERVATION_PREFIX.length).trim(),
		};
	}
	return {
		closedAt: bead.closed_at ?? null,
		harness: request.recipe.harness,
		id: request.id,
		identity: request.identity,
		kind: request.recipe.kind,
		model: request.recipe.model,
		needsAttention: requestNeedsAttention(bead),
		observation,
		outcome: requestOutcome(bead),
		requester: bead.created_by ?? null,
		status: bead.status,
		stdout: latestStdoutActivity(bead) ?? null,
		taskIds: request.taskIds,
	};
}

function card(
	bead: Omit<SummaryBead, "dependency_count" | "dependent_count">,
	requests: Bee[],
	isWorkflowGenerated: boolean,
): Card {
	return {
		assignee: bead.assignee ?? null,
		owner: bead.owner ?? null,
		beeAssignments: requests
			.filter(
				(request) =>
					bead.status === "in_progress" &&
					request.outcome === "pending" &&
					request.identity === bead.assignee &&
					request.taskIds.includes(bead.id),
			)
			.map(({ id, kind, stdout }) => ({ id, kind, stdout })),
		id: bead.id,
		isWorkflowGenerated,
		merges: [],
		labels: bead.labels,
		priority: bead.priority,
		status: bead.status,
		title: bead.title,
		updatedAt: bead.updated_at,
	};
}

/** Traverse only requested ancestry. Names are attribution, never unique parent keys. */
// Bounded traversal keeps ambiguity, cycles and recorded attribution together.
// eslint-disable-next-line max-statements
async function readProvenance(context: ReadContext, id: string): Promise<Provenance> {
	const chain: Bee[] = [];
	const seen = new Set<string>();
	let current = await show(context, id);
	let end: Provenance["end"] = { kind: "limit" };
	/* eslint-disable no-await-in-loop -- Each ancestry step depends on the recorded requester in its predecessor. */
	for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
		if (seen.has(current.id)) {
			end = { id: current.id, kind: "cycle" };
			break;
		}
		seen.add(current.id);
		const item = bee(current);
		chain.push(item);
		if (item.requester === null) {
			end = { kind: "unmatched", requester: null };
			break;
		}
		const matches = await list(context, {
			labels: ["system", "bee"],
			assignee: item.requester,
			all: true,
			limit: 3,
		});
		if (matches.length === 0) {
			end = { kind: "unmatched", requester: item.requester };
			break;
		}
		if (matches.length > 1) {
			end = {
				candidates: matches.map((match) => match.id),
				kind: "ambiguous",
				requester: item.requester,
			};
			break;
		}
		current = await show(context, matches[0]!.id);
	}
	/* eslint-enable no-await-in-loop */
	return { chain, end, fetchedAt: new Date().toISOString() };
}
