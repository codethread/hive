/* eslint-disable unicorn/no-null -- Resource states retain an explicit last-known snapshot. */
import type {
	BoardFilter,
	BoardScope,
	Hierarchy,
	InventoryFilter,
	Navigation,
} from "../contracts.ts";
import {
	apiErrorSchema,
	boardFilterSchema,
	boardKey,
	boardSchema,
	boardScopeSchema,
	coloniesSchema,
	detailKey,
	detailSchema,
	hierarchyKey,
	hierarchySchema,
	inventoryFilterSchema,
	inventoryKey,
	provenanceSchema,
	requestInventorySchema,
} from "../contracts.ts";
import { beadFamilies } from "../hierarchy.ts";
import { createStore } from "zustand/vanilla";
import type { z } from "zod";

const CACHE_MS = 10_000;
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
export const details = createResource(detailSchema);
export const hierarchies = createHierarchyResource();
export const outlines = createResource(hierarchySchema);
export const provenance = createResource(provenanceSchema);
export const preferences = createStore<Preferences>(() => ({
	showWorkflowBeads: false,
	outlineClosed: false,
	sidebarCollapsed: false,
	theme: "moss",
	views: {},
}));

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
	if (filter.view === "beads" && resource?.kind === "ready") {
		await loadHierarchy(
			colony,
			resource.data.cards.map((card) => card.id),
			refreshAfter,
		);
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
export function loadDetail(
	colony: string,
	id: string,
	options: { scope: BoardScope; refreshAfter?: number },
): Promise<void> {
	const search = new URLSearchParams({
		refreshAfter: String(options.refreshAfter ?? 0),
		scope: JSON.stringify(options.scope),
	});
	return details.load(
		detailKey(colony, id, options.scope),
		`/api/colonies/${colony}/beads/${encodeURIComponent(id)}?${search}`,
		(options.refreshAfter ?? 0) > 0,
	);
}
export function loadHierarchy(colony: string, ids: string[], refreshAfter = 0): Promise<void> {
	const key = hierarchyKey(colony, ids);
	const search = new URLSearchParams({
		ids: JSON.stringify(ids),
		refreshAfter: String(refreshAfter),
	});
	return hierarchies.load(key, `/api/colonies/${colony}/hierarchy?${search}`, refreshAfter > 0);
}

/** Complete families and aliases share one publication boundary, including out-of-order responses. */
export function createHierarchyResource(
	read: (path: string) => Promise<Hierarchy> = (path) => request(path, hierarchySchema),
) {
	return createResource(hierarchySchema, read, publishHierarchy);
}
export function loadOutline(colony: string, id: string, refreshAfter = 0): Promise<void> {
	return outlines.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/outline/${encodeURIComponent(id)}?refreshAfter=${refreshAfter}`,
		refreshAfter > 0,
	);
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
		work.push(
			loadHierarchy(colony, [navigation.bead], refreshAfter),
			loadDetail(colony, navigation.bead, { refreshAfter, scope }),
		);
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
/** Routes and event actions load; components subscribe. No effects or duplicate Router cache. */
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
			nodes: family.rows.map(({ node }) => node),
			fetchedAt: resource.data.fetchedAt,
		};
		for (const { node } of family.rows) {
			next[hierarchyKey(colony, [node.id])] = { ...resource, data };
		}
	}
	return next;
}

// Account for every fetch, decode and validation outcome in one transport boundary.
// eslint-disable-next-line max-statements
async function request<Value>(path: string, schema: z.ZodType<Value>): Promise<Value> {
	const start = performance.now();
	let requestId: string | null = null;
	let status: number | null = null;
	let bytes: number | null = null;
	let outcome = "error";
	try {
		const response = await fetch(path);
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
