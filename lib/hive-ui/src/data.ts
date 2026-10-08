/* eslint-disable unicorn/no-null -- Resource states retain an explicit last-known snapshot. */
import type { BoardFilter, Navigation } from "../contracts.ts";
import {
	apiErrorSchema,
	boardKey,
	boardSchema,
	coloniesSchema,
	detailSchema,
	provenanceSchema,
} from "../contracts.ts";
import { createStore } from "zustand/vanilla";
import type { z } from "zod";

const CACHE_MS = 10_000;
export type Resource<Value> =
	| { kind: "empty" }
	| { kind: "loading"; previous: Value | null }
	| { kind: "ready"; data: Value; receivedAt: number }
	| { kind: "failed"; previous: Value | null; message: string };
export const EMPTY = { kind: "empty" } as const;
interface ResourceState<Value> {
	/** One snapshot per exact colony/resource/filter key. */
	entries: Record<string, Resource<Value>>;
}
interface Preferences {
	/** Two settled visual themes; kept outside the component lifecycle. */
	theme: "moss" | "paper";
	/** Last navigation for each endpoint; Router remains current URL authority. */
	views: Record<string, Navigation>;
}

export const colonies = createResource(coloniesSchema);
export const boards = createResource(boardSchema);
export const details = createResource(detailSchema);
export const provenance = createResource(provenanceSchema);
export const preferences = createStore<Preferences>(() => ({ theme: "moss", views: {} }));

export function loadColonies(): Promise<void> {
	return colonies.load("colonies", "/api/colonies");
}
export function loadBoard(colony: string, filter: BoardFilter, fresh = false): Promise<void> {
	const search = new URLSearchParams({ filter: JSON.stringify(filter), fresh: String(fresh) });
	return boards.load(boardKey(colony, filter), `/api/colonies/${colony}/board?${search}`, fresh);
}
export function loadDetail(colony: string, id: string, fresh = false): Promise<void> {
	return details.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/beads/${encodeURIComponent(id)}`,
		fresh,
	);
}
export function loadProvenance(colony: string, id: string): Promise<void> {
	return provenance.load(
		`${colony}/${id}`,
		`/api/colonies/${colony}/provenance/${encodeURIComponent(id)}`,
	);
}
export function rememberView(colony: string, navigation: Navigation): void {
	preferences.setState((state) => ({ views: { ...state.views, [colony]: navigation } }));
}
export function snapshot<Value>(resource: Resource<Value>): Value | null {
	if (resource.kind === "ready") {
		return resource.data;
	}
	if (resource.kind === "loading" || resource.kind === "failed") {
		return resource.previous;
	}
	return null;
}

// --- Resource and HTTP ownership ---
/** Routes and event actions load; components subscribe. No effects or duplicate Router cache. */
function createResource<Value>(schema: z.ZodType<Value>) {
	const store = createStore<ResourceState<Value>>(() => ({ entries: {} }));
	const pending = new Map<string, Promise<void>>();
	const put = (key: string, value: Resource<Value>) => {
		store.setState((state) => ({ entries: { ...state.entries, [key]: value } }));
	};
	// eslint-disable-next-line max-statements -- One load action owns coalescing, freshness and previous-data retention.
	const load = (key: string, path: string, fresh = false): Promise<void> => {
		const active = pending.get(key);
		if (active) {
			return active;
		}
		const previous = store.getState().entries[key] ?? EMPTY;
		if (!fresh && previous.kind === "ready" && Date.now() - previous.receivedAt < CACHE_MS) {
			return Promise.resolve();
		}
		put(key, { kind: "loading", previous: snapshot(previous) });
		const run = async () => {
			try {
				put(key, { data: await request(path, schema), kind: "ready", receivedAt: Date.now() });
			} catch (error) {
				put(key, {
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
					previous: snapshot(previous),
				});
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

// eslint-disable-next-line max-statements -- Account for every fetch, decode and validation outcome in one transport boundary.
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
