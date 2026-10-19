/* eslint-disable unicorn/no-null -- Resource states retain an explicit last-known snapshot. */

import {
	ANNOTATION_BATCH,
	annotationKey,
	apiErrorSchema,
	boardFilterSchema,
	boardKey,
	boardSchema,
	boardScopeSchema,
	cardAnnotationsSchema,
	coloniesSchema,
	detailKey,
	detailSchema,
	hierarchyKey,
	hierarchySchema,
	inventoryFilterSchema,
	inventoryKey,
	provenanceSchema,
	requestInventorySchema,
	workflowCheckpointSchema,
	workflowInspectionSchema,
	workflowSimulationSchema,
} from "../contracts.ts";
import type {
	BoardFilter,
	BoardScope,
	Card,
	CardAnnotations,
	Hierarchy,
	InventoryFilter,
	Navigation,
	WorkflowCheckpoint,
	WorkflowInspection,
	WorkflowSimulationRequest,
} from "../contracts.ts";
import { beadFamilies } from "../hierarchy.ts";
import { createStore } from "zustand/vanilla";
import type { z } from "zod";

const CACHE_MS = 10_000;
const workflowReads = {
	inspect: (path: string) => request(path, workflowInspectionSchema),
	checkpoint: (path: string) => request(`${path}?checkpointOnly=true`, workflowCheckpointSchema),
};
let lastLoadKeys = { page: "", bead: "", ancestry: "" };
export type Resource<Value> =
	| { kind: "empty" }
	| { kind: "loading"; previous: Value | null }
	| { kind: "ready"; data: Value; receivedAt: number }
	| { kind: "stale"; data: Value }
	| { kind: "failed"; previous: Value | null; message: string };
export const EMPTY = { kind: "empty" } as const;
interface ResourceState<Value> {
	/** One snapshot per exact colony/resource/filter key. */
	entries: Record<string, Resource<Value>>;
}
interface Preferences {
	/** Workflow-generated cards are hidden on the board until explicitly shown. */
	showWorkflowBeads: boolean;
	/** Closed visibility shared by outline views, independent of the Kanban predicate. */
	outlineClosed: boolean;
	/** Sidebar width preference, independent of URL filters and native data reads. */
	sidebarCollapsed: boolean;
	/** Two settled visual themes; kept outside the component lifecycle. */
	theme: "moss" | "paper";
	/** Last navigation for each endpoint; Router remains current URL authority. */
	views: Record<string, Navigation>;
}

export const colonies = createResource(coloniesSchema);
export const boards = createResource(boardSchema);
export const inventories = createResource(requestInventorySchema);
export const annotations = createCardAnnotationsResource();
export const details = createResource(detailSchema);
export const hierarchies = createHierarchyResource();
export const outlines = createResource(hierarchySchema);
export const workflows = createWorkflowResource();
export const workflowSelection = createStore<
	{ kind: "closed" } | { kind: "open"; colony: string; id: string; trigger: HTMLButtonElement }
>(() => ({ kind: "closed" }));
export const provenance = createResource(provenanceSchema);
export const preferences = createStore<Preferences>(() => ({
	showWorkflowBeads: false,
	outlineClosed: false,
	sidebarCollapsed: true,
	theme: "moss",
	views: {},
}));

/** Open/manual reads inspect unconditionally; automatic polls check the checkpoint first. */
export function loadWorkflow(colony: string, id: string, conditional = false): Promise<void> {
	return workflows.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/workflow/${encodeURIComponent(id)}`,
		conditional,
	);
}

/** Workflow reads coalesce and keep the displayed snapshot during background refresh. */
export function createWorkflowResource(
	read: {
		inspect: (path: string) => Promise<WorkflowInspection>;
		checkpoint: (path: string) => Promise<WorkflowCheckpoint>;
	} = workflowReads,
) {
	const store = createStore<ResourceState<WorkflowInspection>>(() => ({ entries: {} }));
	const pending = new Map<string, { work: Promise<void>; selection: { full: boolean } }>();
	const put = (key: string, value: Resource<WorkflowInspection>) => {
		store.setState((state) => ({ entries: { ...state.entries, [key]: value } }));
	};
	// eslint-disable-next-line max-statements -- Own coalescing, checkpoint checks and snapshot retention.
	const load = (key: string, path: string, conditional = false): Promise<void> => {
		const active = pending.get(key);
		if (active) {
			active.selection.full ||= !conditional;
			return active.work;
		}
		const previous = store.getState().entries[key] ?? EMPTY;
		const saved = snapshot(previous);
		const selection = { full: !conditional || previous.kind === "failed" };
		if (saved === null) {
			put(key, { kind: "loading", previous: null });
		}
		// eslint-disable-next-line max-statements -- Keep checkpoint comparison and recovery within one read.
		const refresh = async () => {
			try {
				let data = saved;
				if (!selection.full && saved !== null) {
					const checkpoint = await read.checkpoint(path);
					if (
						checkpoint.runId !== saved.runId ||
						checkpoint.checkpoint !== saved.checkpoint ||
						checkpoint.savedAt !== saved.savedAt
					) {
						selection.full = true;
					}
				}
				if (selection.full || saved === null) {
					data = await read.inspect(path);
				}
				if (data !== saved || previous.kind !== "ready") {
					put(key, { kind: "ready", data: data!, receivedAt: Date.now() });
				}
			} catch (error) {
				put(key, {
					kind: "failed",
					previous: saved,
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				pending.delete(key);
			}
		};
		const work = refresh();
		pending.set(key, { work, selection });
		return work;
	};
	return { store, load };
}

export function simulateWorkflow(colony: string, id: string, input: WorkflowSimulationRequest) {
	return request(
		`/api/colonies/${colony}/workflow/${encodeURIComponent(id)}/simulate`,
		workflowSimulationSchema,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		},
	);
}

export function loadColonies(): Promise<void> {
	return colonies.load("colonies", "/api/colonies");
}
export async function loadBoard(
	colony: string,
	filter: BoardFilter,
	refreshAfter = 0,
): Promise<void> {
	const search = new URLSearchParams({
		filter: JSON.stringify(filter),
		refreshAfter: String(refreshAfter),
	});
	await boards.load(
		boardKey(colony, filter),
		`/api/colonies/${colony}/board?${search}`,
		refreshAfter > 0,
	);
	const resource = boards.store.getState().entries[boardKey(colony, filter)];
	if (resource?.kind === "ready") {
		const ids = resource.data.cards.map((card) => card.id);
		await Promise.all([
			loadAnnotations(colony, ids, refreshAfter),
			...(filter.view === "beads" ? [loadHierarchy(colony, ids, refreshAfter)] : []),
		]);
	}
}
export function loadInventory(
	colony: string,
	filter: InventoryFilter,
	refreshAfter = 0,
): Promise<void> {
	const search = new URLSearchParams({
		filter: JSON.stringify(filter),
		refreshAfter: String(refreshAfter),
	});
	return inventories.load(
		inventoryKey(colony, filter),
		`/api/colonies/${colony}/inventory?${search}`,
		refreshAfter > 0,
	);
}
/** Selected detail identifies reference records before any ordinary-task family read. */
export async function loadBead(
	colony: string,
	id: string,
	options: { scope: BoardScope; refreshAfter?: number },
): Promise<void> {
	const search = new URLSearchParams({
		refreshAfter: String(options.refreshAfter ?? 0),
		scope: JSON.stringify(options.scope),
	});
	const key = detailKey(colony, id, options.scope);
	await details.load(
		key,
		`/api/colonies/${colony}/beads/${encodeURIComponent(id)}?${search}`,
		(options.refreshAfter ?? 0) > 0,
	);
	const resource = details.store.getState().entries[key];
	if (resource?.kind === "ready") {
		const work = [loadAnnotations(colony, [id], options.refreshAfter ?? 0)];
		if (!resource.data.card.labels.includes("merge")) {
			work.push(loadHierarchy(colony, [id], options.refreshAfter ?? 0));
		}
		await Promise.all(work);
	}
}
export async function loadHierarchy(
	colony: string,
	ids: string[],
	refreshAfter = 0,
): Promise<void> {
	const key = hierarchyKey(colony, ids);
	const search = new URLSearchParams({
		ids: JSON.stringify(ids),
		refreshAfter: String(refreshAfter),
	});
	await hierarchies.load(key, `/api/colonies/${colony}/hierarchy?${search}`, refreshAfter > 0);
	const resource = hierarchies.store.getState().entries[key];
	if (resource?.kind === "ready") {
		await loadAnnotations(
			colony,
			resource.data.nodes.map((node) => node.id),
			refreshAfter,
		);
	}
}

export async function loadAnnotations(
	colony: string,
	ids: string[],
	refreshAfter = 0,
): Promise<void> {
	for (const batch of annotationBatches(ids)) {
		// eslint-disable-next-line no-await-in-loop -- Bound optional metadata reads independently of primary resources.
		await annotations.loadBatch(colony, batch, refreshAfter);
	}
}

export function createCardAnnotationsResource(
	read: (path: string) => Promise<CardAnnotations> = (path) => request(path, cardAnnotationsSchema),
	now: () => number = Date.now,
) {
	const resource = createResource(cardAnnotationsSchema, read, publishAnnotations);
	const pending = new Map<
		string,
		{ startedAt: number; work: Promise<Resource<CardAnnotations>> }
	>();
	const freshness = new Map<
		string,
		{ startedAt: number; receivedAt: number; entry: Resource<CardAnnotations> }
	>();
	const demands = new Map<string, object>();
	// eslint-disable-next-line max-statements -- One demand owns alias reuse, overlapping reads and its batch notice.
	const loadBatch = async (
		colony: string,
		requested: string[],
		refreshAfter = 0,
	): Promise<void> => {
		const ids = [...new Set(requested)].toSorted();
		if (ids.length === 0) {
			return;
		}
		const aliases = ids.map((id) => hierarchyKey(colony, [id]));
		const older = aliases.flatMap((alias) => {
			const active = pending.get(alias);
			return active && active.startedAt < refreshAfter ? [active.work] : [];
		});
		if (older.length > 0) {
			await Promise.all(older);
			return loadBatch(colony, ids, refreshAfter);
		}
		const { entries } = resource.store.getState();
		const missing = ids.filter((_id, index) => {
			const alias = aliases[index]!;
			const entry = entries[alias];
			const saved = freshness.get(alias);
			return (
				!pending.has(alias) &&
				!(
					entry?.kind === "ready" &&
					saved?.entry === entry &&
					saved.startedAt >= refreshAfter &&
					now() - saved.receivedAt < CACHE_MS
				)
			);
		});
		const key = annotationKey(colony, ids);
		const previous = snapshot(entries[key] ?? EMPTY);
		const demand = {};
		demands.set(key, demand);
		resource.store.setState((state) => ({
			entries: { ...state.entries, [key]: { kind: "loading", previous } },
		}));
		if (missing.length > 0) {
			const startedAt = now();
			const readKey = `${annotationKey(colony, missing)}/read`;
			const search = new URLSearchParams({
				ids: JSON.stringify(missing),
				refreshAfter: String(refreshAfter),
			});
			// eslint-disable-next-line max-statements -- Keep read results, freshness and failure invalidation together.
			const fetchBatch = async () => {
				await resource.load(readKey, `/api/colonies/${colony}/annotations?${search}`, true);
				const result = resource.store.getState().entries[readKey]!;
				for (const id of missing) {
					const alias = hierarchyKey(colony, [id]);
					pending.delete(alias);
					if (result.kind === "ready") {
						if (!result.data.cards.some((card) => card.id === id)) {
							resource.store.setState((state) => ({
								entries: {
									...state.entries,
									[alias]: { ...result, data: { ...result.data, cards: [] } },
								},
							}));
						}
						freshness.set(alias, {
							startedAt,
							receivedAt: now(),
							entry: resource.store.getState().entries[alias]!,
						});
					} else {
						freshness.delete(alias);
					}
				}
				return result;
			};
			const work = fetchBatch();
			for (const id of missing) {
				pending.set(hierarchyKey(colony, [id]), { startedAt, work });
			}
		}
		const work = new Set(aliases.flatMap((alias) => pending.get(alias)?.work ?? []));
		const results = await Promise.all(work);
		const failure = results.find((result) => result.kind === "failed");
		// A cached demand can finish after a newer refresh has published its loading notice.
		if (demands.get(key) !== demand) {
			return;
		}
		resource.store.setState((state) => ({
			entries: {
				...state.entries,
				[key]: failure
					? { ...failure, previous }
					: {
							kind: "ready",
							receivedAt: now(),
							data: {
								cards: aliases.flatMap(
									(alias) => snapshot(state.entries[alias] ?? EMPTY)?.cards ?? [],
								),
								fetchedAt: aliases
									.map((alias) => snapshot(state.entries[alias]!)!.fetchedAt)
									.toSorted((left, right) => Date.parse(left) - Date.parse(right))[0]!,
							},
						},
			},
		}));
	};
	return { ...resource, loadBatch };
}

export function annotationStatus(
	colony: string,
	groups: string[][],
	entries: ResourceState<CardAnnotations>["entries"],
): Resource<CardAnnotations> {
	const resources = groups.flatMap((ids) =>
		annotationBatches(ids).map((batch) => entries[annotationKey(colony, batch)] ?? EMPTY),
	);
	return (
		resources.find((resource) => resource.kind === "failed") ??
		resources.find((resource) => resource.kind === "loading") ??
		resources.find((resource) => resource.kind === "stale") ??
		resources.find((resource) => resource.kind === "empty") ??
		resources[0] ??
		EMPTY
	);
}

export function annotateCards<Value extends Card>(
	cards: Value[],
	colony: string,
	entries: ResourceState<CardAnnotations>["entries"],
): Value[] {
	return cards.map((card) => {
		const value = snapshot(entries[hierarchyKey(colony, [card.id])] ?? EMPTY)?.cards[0];
		return value?.updatedAt === card.updatedAt ? { ...card, ...value } : card;
	});
}
export function annotateHierarchy(
	hierarchy: Hierarchy | null,
	colony: string,
	entries: ResourceState<CardAnnotations>["entries"],
): Hierarchy | null {
	return hierarchy && { ...hierarchy, nodes: annotateCards(hierarchy.nodes, colony, entries) };
}

/** Complete families and aliases share one publication boundary, including out-of-order responses. */
export function createHierarchyResource(
	read: (path: string) => Promise<Hierarchy> = (path) => request(path, hierarchySchema),
) {
	return createResource(hierarchySchema, read, publishHierarchy);
}
export async function loadOutline(colony: string, id: string, refreshAfter = 0): Promise<void> {
	await outlines.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/outline/${encodeURIComponent(id)}?refreshAfter=${refreshAfter}`,
		refreshAfter > 0,
	);
	const resource = outlines.store.getState().entries[`${colony}/${id}`];
	if (resource?.kind === "ready") {
		await loadAnnotations(
			colony,
			resource.data.nodes.map((node) => node.id),
			refreshAfter,
		);
	}
}
export function loadProvenance(colony: string, id: string, fresh = false): Promise<void> {
	return provenance.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/provenance/${encodeURIComponent(id)}`,
		fresh,
	);
}
/** Route changes load only changed visible resources; selection never refreshes the board behind it. */
// eslint-disable-next-line max-statements -- Compare resource identities before dispatching independent visible reads.
export async function loadView(
	colony: string,
	navigation: Navigation,
	fresh = false,
): Promise<void> {
	const scope = boardScopeSchema.parse(navigation);
	const refreshAfter = fresh ? Date.now() : 0;
	const keys = {
		page: JSON.stringify([
			boardKey(colony, boardFilterSchema.parse(navigation)),
			navigation.outline,
		]),
		bead: navigation.bead === undefined ? "" : detailKey(colony, navigation.bead, scope),
		ancestry:
			scope.view === "beads" || navigation.ancestry === undefined
				? ""
				: `${colony}/${navigation.ancestry}`,
	};
	const changed = {
		page: fresh || keys.page !== lastLoadKeys.page,
		bead: fresh || keys.bead !== lastLoadKeys.bead,
		ancestry: fresh || keys.ancestry !== lastLoadKeys.ancestry,
	};
	lastLoadKeys = keys;
	const work: Promise<void>[] = [];
	if (changed.page) {
		if (scope.view !== "beads") {
			work.push(loadInventory(colony, inventoryFilterSchema.parse(navigation), refreshAfter));
		}
		if (scope.view === "beads" && navigation.outline !== undefined) {
			work.push(loadOutline(colony, navigation.outline, refreshAfter));
		} else if (scope.view === "beads" || navigation.request !== undefined) {
			work.push(loadBoard(colony, boardFilterSchema.parse(navigation), refreshAfter));
		}
	}
	if (changed.bead && navigation.bead !== undefined) {
		work.push(loadBead(colony, navigation.bead, { refreshAfter, scope }));
	}
	if (changed.ancestry && keys.ancestry !== "" && navigation.ancestry !== undefined) {
		work.push(loadProvenance(colony, navigation.ancestry, fresh));
	}
	await Promise.all(work);
}
export function rememberView(colony: string, navigation: Navigation): void {
	preferences.setState((state) => ({ views: { ...state.views, [colony]: navigation } }));
}
export function snapshot<Value>(resource: Resource<Value>): Value | null {
	if (resource.kind === "ready" || resource.kind === "stale") {
		return resource.data;
	}
	if (resource.kind === "loading" || resource.kind === "failed") {
		return resource.previous;
	}
	return null;
}

// --- Resource and HTTP ownership ---
function annotationBatches(ids: string[]): string[][] {
	const batches: string[][] = [];
	for (let offset = 0; offset < ids.length; offset += ANNOTATION_BATCH) {
		batches.push(ids.slice(offset, offset + ANNOTATION_BATCH));
	}
	return batches;
}

function publishAnnotations(
	entries: ResourceState<CardAnnotations>["entries"],
	key: string,
	resource: Extract<Resource<CardAnnotations>, { kind: "ready" }>,
): ResourceState<CardAnnotations>["entries"] {
	const colony = key.slice(0, key.indexOf("/"));
	const next = { ...entries };
	const cards = resource.data.cards.map((card) => {
		const alias = hierarchyKey(colony, [card.id]);
		const previous = snapshot(entries[alias] ?? EMPTY);
		const current = previous?.cards[0];
		const fetchedAt =
			previous && previous.fetchedAt > resource.data.fetchedAt
				? previous.fetchedAt
				: resource.data.fetchedAt;
		const value = current ? reconcileAnnotation(current, card) : card;
		next[alias] = { ...resource, data: { ...resource.data, fetchedAt, cards: [value] } };
		return value;
	});
	const previous = snapshot(next[key] ?? EMPTY);
	const fetchedAt =
		previous && previous.fetchedAt > resource.data.fetchedAt
			? previous.fetchedAt
			: resource.data.fetchedAt;
	next[key] = { ...resource, data: { ...resource.data, fetchedAt, cards } };
	return next;
}

function reconcileAnnotation(
	current: CardAnnotations["cards"][number],
	incoming: CardAnnotations["cards"][number],
): CardAnnotations["cards"][number] {
	const task = current.updatedAt > incoming.updatedAt ? current : incoming;
	const merges = incoming.sources.merges >= current.sources.merges ? incoming : current;
	// Assignments depend on task status and assignee; compare source versions within that context.
	let assignments = task;
	if (current.status === incoming.status && current.assignee === incoming.assignee) {
		assignments = incoming.sources.assignments >= current.sources.assignments ? incoming : current;
	}
	return {
		...task,
		merges: merges.merges,
		beeAssignments: assignments.beeAssignments,
		sources: { merges: merges.sources.merges, assignments: assignments.sources.assignments },
	};
}

/** Zustand load actions own snapshots; routes, actions and refresh actors call them. */
function createResource<Value>(
	schema: z.ZodType<Value>,
	read: (path: string) => Promise<Value> = (path) => request(path, schema),
	complete?: (
		entries: ResourceState<Value>["entries"],
		key: string,
		resource: Extract<Resource<Value>, { kind: "ready" }>,
	) => ResourceState<Value>["entries"],
) {
	const store = createStore<ResourceState<Value>>(() => ({ entries: {} }));
	const pending = new Map<string, Promise<void>>();
	const put = (key: string, value: Resource<Value>) => {
		store.setState((state) => ({ entries: { ...state.entries, [key]: value } }));
	};
	// eslint-disable-next-line max-statements -- One load action owns coalescing, freshness and previous-data retention.
	const load = async (key: string, path: string, fresh = false): Promise<void> => {
		const active = pending.get(key);
		if (active) {
			if (!fresh) {
				return active;
			}
			await active;
			return load(key, path, true);
		}
		const previous = store.getState().entries[key] ?? EMPTY;
		if (!fresh && previous.kind === "ready" && Date.now() - previous.receivedAt < CACHE_MS) {
			return;
		}
		const loading = { kind: "loading", previous: snapshot(previous) } as const;
		put(key, loading);
		const run = async () => {
			try {
				const resource = { data: await read(path), kind: "ready", receivedAt: Date.now() } as const;
				store.setState((state) => ({
					entries: complete
						? complete(state.entries, key, resource)
						: { ...state.entries, [key]: resource },
				}));
			} catch (error) {
				// A newer overlapping family may already have satisfied this member alias.
				if (store.getState().entries[key] === loading) {
					put(key, {
						kind: "failed",
						message: error instanceof Error ? error.message : String(error),
						previous: snapshot(previous),
					});
				}
			} finally {
				pending.delete(key);
			}
		};
		const work = run();
		pending.set(key, work);
		return work;
	};
	return { load, store };
}

// Retire overlapping snapshots and publish complete member aliases atomically.
// eslint-disable-next-line max-statements
function publishHierarchy(
	entries: ResourceState<Hierarchy>["entries"],
	key: string,
	resource: Extract<Resource<Hierarchy>, { kind: "ready" }>,
): ResourceState<Hierarchy>["entries"] {
	// Hierarchy keys prefix browser resources with the server's opaque colony ID.
	const colony = key.slice(0, key.indexOf("/"));
	const prefix = `${colony}/`;
	const members = new Set(resource.data.nodes.map((node) => node.id));
	const overlapping = Object.entries(entries).filter(
		([entryKey, entry]) =>
			entryKey.startsWith(prefix) &&
			snapshot(entry)?.nodes.some((node) => members.has(node.id)) === true,
	);
	if (overlapping.some(([, entry]) => snapshot(entry)!.fetchedAt > resource.data.fetchedAt)) {
		const current = entries[key] ?? EMPTY;
		return current.kind === "ready"
			? entries
			: { ...entries, [key]: { kind: "stale", data: snapshot(current) ?? resource.data } };
	}
	const next = { ...entries };
	for (const [entryKey, entry] of overlapping) {
		const data = snapshot(entry)!;
		if (data.fetchedAt < resource.data.fetchedAt && entry.kind !== "loading") {
			next[entryKey] = { kind: "stale", data };
		}
	}
	next[key] = resource;
	for (const family of beadFamilies(resource.data)) {
		const data = {
			...resource.data,
			nodes: family.rows.map(({ node }) => node),
		};
		for (const { node } of family.rows) {
			next[hierarchyKey(colony, [node.id])] = { ...resource, data };
		}
	}
	return next;
}

// Account for every fetch, decode and validation outcome in one transport boundary.
// eslint-disable-next-line max-statements
async function request<Value>(
	path: string,
	schema: z.ZodType<Value>,
	init?: RequestInit,
): Promise<Value> {
	const start = performance.now();
	let requestId: string | null = null;
	let status: number | null = null;
	let bytes: number | null = null;
	let outcome = "error";
	try {
		const response = await fetch(path, init);
		requestId = response.headers.get("x-request-id");
		({ status } = response);
		const text = await response.text();
		bytes = new TextEncoder().encode(text).length;
		const body: unknown = JSON.parse(text);
		if (!response.ok) {
			throw new Error(apiErrorSchema.parse(body).message);
		}
		const data = schema.parse(body);
		outcome = "ok";
		return data;
	} finally {
		const ms = Math.round(performance.now() - start);
		console.info(
			JSON.stringify({
				bytes,
				ms,
				operation: path,
				outcome,
				requestId,
				scope: "client",
				status,
			}),
		);
	}
}
