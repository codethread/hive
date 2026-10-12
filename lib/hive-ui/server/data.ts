/* eslint-disable unicorn/no-null -- API contracts represent absent recorded facts explicitly. */
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
	Provenance,
	RequestInventory,
} from "../contracts.ts";
import type {
	BeadRecord,
	BeadRow,
	BeadSelection,
	BeadsScope,
	BeadsService,
	SelectedBead,
} from "@hive/beads";
import {
	COLONY_OBSERVATION_PREFIX,
	latestColonyObservation,
	readSpawnRequest,
	requestOutcome,
} from "@hive/shared";
import { PAGE_SIZE, RELATION_LIMIT, REQUEST_PAGE_SIZE } from "../contracts.ts";
import { beadFamilies, branchRows } from "../hierarchy.ts";
import { formatBeadsQuery } from "@hive/beads";
import { readHierarchy } from "./hierarchy.ts";
import { taskSelection } from "./query.ts";

const MAX_REQUESTS = 100;
const TASK_MATCH_BATCH = 100;
const MAX_ANCESTORS = 8;
const INVENTORY_TTL_MS = 10_000;
type Inventory = Extract<RequestInventory, { kind: "loaded" }>;
interface InventorySnapshot {
	/** Native lookup start, used to satisfy a refresh cutoff independently of response completion. */
	startedAt: number;
	/** Bounded request inventory retaining its source read time. */
	value: Inventory;
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

/** Owns native reads and a short-lived, endpoint- and scope-keyed request inventory. */
export function createBoardData() {
	// A refresh cutoff is shared by its inventory, board and detail requests. Zero uses the normal TTL.
	const inventories = new Map<string, InventorySnapshot>();
	const pendingInventories = new Map<string, Promise<Inventory>>();
	const branches = new Map<string, { startedAt: number; value: Hierarchy }>();
	const pendingBranches = new Map<string, Promise<Hierarchy>>();
	// eslint-disable-next-line max-statements -- Coalesce endpoint reads while retaining the original source freshness.
	const inventory = async (
		context: ReadContext,
		scope: BoardScope,
		refreshAfter: number,
	): Promise<RequestInventory> => {
		if (scope.view === "beads") {
			return { kind: "not_requested" };
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
			Date.now() - Date.parse(existing.value.readAt) < INVENTORY_TTL_MS
		) {
			return existing.value;
		}
		const startedAt = Date.now();
		const pending = readInventory(context, scope);
		pendingInventories.set(key, pending);
		try {
			const value = await pending;
			inventories.set(key, { startedAt, value });
			return value;
		} catch (error) {
			inventories.delete(key);
			throw error;
		} finally {
			pendingInventories.delete(key);
		}
	};
	const cards = async (
		context: ReadContext,
		tasks: BeadRow[],
		refreshAfter: number,
	): Promise<Card[]> => {
		let assignments: Bee[] = [];
		if (tasks.some((task) => task.status === "in_progress" && (task.assignee ?? "") !== "")) {
			const open = await inventory(context, { requestPage: 0, view: "open" }, refreshAfter);
			if (open.kind === "loaded") {
				assignments = open.bees;
			}
		}
		return tasks.map((task) => card(task, assignments));
	};
	// eslint-disable-next-line max-statements -- Coalesce overlapping family reads and reuse only complete, fresh components.
	const hierarchy = async (
		context: ReadContext,
		ids: string[],
		{ direction, refreshAfter }: { direction: "family" | "descendants"; refreshAfter: number },
	): Promise<Hierarchy> => {
		if (ids.length === 0) {
			return { nodes: [], fetchedAt: new Date().toISOString() };
		}
		const colony = context.colony.id;
		const active = pendingBranches.get(colony);
		if (active) {
			// The previous caller owns its result; a queued scope only waits for the slot.
			await Promise.allSettled([active]);
			return hierarchy(context, ids, { direction, refreshAfter });
		}
		for (const [key, entry] of branches) {
			if (Date.now() - Date.parse(entry.value.fetchedAt) >= INVENTORY_TTL_MS) {
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
			};
			if (direction === "descendants") {
				value.nodes = branchRows(
					value,
					nodes.find((node) => node.id === ids[0])!,
				).map(({ node }) => node);
			}
			return value;
		}
		const startedAt = Date.now();
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
					const branch = { nodes: family.rows.map(({ node }) => node), fetchedAt: value.fetchedAt };
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
		const records = await readHierarchy(
			ids,
			{
				rows: async (batch) => {
					const rows = await list(context, {
						ids: batch,
						all: true,
						deferred: true,
						limit: batch.length,
					});
					const found = new Set(rows.map((row) => row.id));
					const missing = batch.filter((id) => !found.has(id));
					// Native list omits tombstones/templates even with --all; exact reads retain linked nodes.
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
				edges: (id) =>
					read(context, ["dep", "list", id, "--direction", "both", "--type", "parent-child"], () =>
						context.beads.dep.list(readScope(context), id, {
							direction: "both",
							type: "parent-child",
						}),
					),
			},
			direction,
		);
		const summaries = await cards(
			context,
			records.map(({ bead }) => bead),
			refreshAfter,
		);
		return {
			nodes: summaries.map((summary, index) =>
				Object.assign(summary, {
					parentIds: records[index]!.parentIds,
				}),
			),
			fetchedAt: new Date().toISOString(),
		};
	};
	return {
		board: async (
			context: ReadContext,
			filter: BoardFilter,
			refreshAfter: number,
		): Promise<Board> => {
			const current = await inventory(context, filter, refreshAfter);
			const { tasks, query } = await readTasks(context, filter, current);
			const page = tasks.slice(0, PAGE_SIZE);
			const summaries = await cards(context, page, refreshAfter);
			return {
				cards: summaries,
				fetchedAt: new Date().toISOString(),
				hasMore: tasks.length > PAGE_SIZE,
				labels: [...new Set(summaries.flatMap((item) => item.labels))].toSorted(),
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
			const [summary] = await cards(context, [bead], refreshAfter);
			let bees: Bee[] = [];
			if (current.kind === "loaded") {
				({ bees } = current);
			}
			return {
				acceptanceCriteria: bead.acceptance_criteria,
				card: {
					...summary!,
					bees: bees.filter((item) => item.taskIds.includes(bead.id)),
				},
				comments: bead.comments.map((comment) => ({
					at: comment.created_at,
					author: comment.author,
					id: comment.id,
					text: comment.text,
				})),
				dependencies: relations(
					bead.dependencies.filter((edge) => edge.dependency_type !== "parent-child"),
				),
				dependents: relations(
					bead.dependents.filter((edge) => edge.dependency_type !== "parent-child"),
				),
				description: bead.description,
				fetchedAt: new Date().toISOString(),
			};
		},
		inventory: async (
			context: ReadContext,
			filter: InventoryFilter,
			refreshAfter: number,
		): Promise<RequestInventory> => {
			const current = await inventory(context, filter, refreshAfter);
			return filterInventory(context, filter, current);
		},
		hierarchy: (context: ReadContext, ids: string[], refreshAfter: number) =>
			hierarchy(context, ids, { direction: "family", refreshAfter }),
		outline: (context: ReadContext, id: string, refreshAfter: number) =>
			hierarchy(context, [id], { direction: "descendants", refreshAfter }),
		provenance: readProvenance,
	};
}

// --- Native I/O and projections ---
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
	inventory: RequestInventory,
): Promise<{ tasks: BeadRow[]; query: string[] }> {
	let taskIds: string[] = [];
	if (inventory.kind === "loaded") {
		if (filter.request === undefined) {
			return { query: [], tasks: [] };
		}
		const request =
			inventory.bees.find((item) => item.id === filter.request) ??
			bee(await show(context, filter.request));
		({ taskIds } = request);
		// An empty request membership must never become an unrestricted task query.
		if (taskIds.length === 0) {
			return { query: [], tasks: [] };
		}
	}
	const selection = taskSelection(filter, taskIds, {
		limit: PAGE_SIZE + 1,
		offset: filter.page * PAGE_SIZE,
	});
	const args = formatBeadsQuery(selection, filter.query || undefined);
	const tasks = await list(context, selection, filter.query);
	const query = [
		"br",
		...args,
		"--no-auto-import",
		"--no-auto-flush",
		"--db",
		context.colony.beadsDb,
		"--actor",
		"hive-ui",
		"--json",
	];
	return { query, tasks };
}

/** Match native task predicates across the whole candidate membership, not the visible task page. */
// eslint-disable-next-line max-statements -- Keep activation, bounded native matching and existential projection together.
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
		// eslint-disable-next-line no-await-in-loop -- Bound native process concurrency and argv size while covering every linked task.
		const tasks = await list(context, selection, filter.query);
		for (const task of tasks) {
			matching.add(task.id);
		}
	}
	return {
		...inventory,
		bees: inventory.bees.filter((request) => request.taskIds.some((id) => matching.has(id))),
	};
}

// eslint-disable-next-line max-statements -- Native execution telemetry covers success, size and failure in one boundary.
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
		actor: "hive-ui",
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
		total: requests.length,
		hasMore: issues.length > limit,
		kind: "loaded",
		readAt: new Date().toISOString(),
	};
}

function bee(bead: BeadRecord): Bee {
	const request = readSpawnRequest(bead);
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
		observation,
		outcome: requestOutcome(bead),
		requester: bead.created_by ?? null,
		status: bead.status,
		taskIds: request.taskIds,
	};
}

function card(bead: BeadRow, requests: Bee[]): Card {
	return {
		assignee: bead.assignee ?? null,
		beeAssignments: requests
			.filter(
				(request) =>
					bead.status === "in_progress" &&
					request.outcome === "pending" &&
					request.identity === bead.assignee &&
					request.taskIds.includes(bead.id),
			)
			.map(({ id, kind }) => ({ id, kind })),
		id: bead.id,
		labels: bead.labels,
		priority: bead.priority,
		status: bead.status,
		title: bead.title,
		updatedAt: bead.updated_at,
	};
}

/** Traverse only requested ancestry. Names are attribution, never unique parent keys. */
// eslint-disable-next-line max-statements -- Bounded traversal keeps ambiguity, cycles and recorded attribution together.
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
