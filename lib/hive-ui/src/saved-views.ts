import type { Navigation } from "../contracts.ts";
import { beadFilterSchema } from "../contracts.ts";
import { createStore } from "zustand/vanilla";
import { z } from "zod";

const STORAGE_KEY = "hive-ui.saved-views";
const MAX_NAME_LENGTH = 80;
const savedViewSchema = z.object({
	/** Filter values only; pagination and bead selection are never saved. */
	filters: beadFilterSchema,
	/** Stable browser-generated identity for renaming and replacement. */
	id: z.uuid(),
	/** Human name, unique within its colony. */
	name: z.string().trim().min(1, "Enter a name for this view.").max(MAX_NAME_LENGTH),
});
const collectionSchema = z.record(z.string(), z.array(savedViewSchema));
export type SavedView = z.infer<typeof savedViewSchema>;
type FilterSet = z.infer<typeof beadFilterSchema>;
type Notice = { kind: "none" } | { kind: "error" | "saved"; message: string };
interface SaveViewInput {
	/** Current URL-owned filters, excluding page and selection. */
	filters: FilterSet;
	/** User-entered name, validated before storage. */
	name: string;
	/** Existing view to replace, or null to create a new view. */
	replaceId: string | null;
}
interface SavedViewsState {
	/** Last chosen preset per colony; edits may make its filters modified. */
	active: Record<string, string>;
	/** Browser-persisted presets keyed by configured endpoint identity. */
	byColony: Record<string, SavedView[]>;
	/** Storage failures and successful saves are visible beside the controls. */
	notice: Notice;
}

export const savedViews = createStore<SavedViewsState>(() => ({ active: {}, ...readViews() }));

export function filterSet(navigation: Navigation): FilterSet {
	return beadFilterSchema.parse(navigation);
}

export function sameFilters(left: FilterSet, right: FilterSet): boolean {
	return filterKey(left) === filterKey(right);
}

export function selectSavedView(colony: string, id: string): void {
	savedViews.setState((state) => ({ active: { ...state.active, [colony]: id } }));
}

/** Persist before publishing success, so failed writes never appear saved. */
export function saveView(colony: string, input: SaveViewInput): void {
	try {
		const stored = readCollection();
		const view = savedViewSchema.parse({
			filters: input.filters,
			id: input.replaceId ?? crypto.randomUUID(),
			name: input.name,
		});
		const current = stored[colony] ?? [];
		if (current.some((entry) => entry.name === view.name && entry.id !== view.id)) {
			throw new Error(
				`A view named “${view.name}” already exists. Choose another name or update it.`,
			);
		}
		const byColony = {
			...stored,
			[colony]: [...current.filter((entry) => entry.id !== view.id), view],
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(byColony));
		savedViews.setState((state) => ({
			active: { ...state.active, [colony]: view.id },
			byColony,
			notice: { kind: "saved", message: `Saved “${view.name}”.` },
		}));
	} catch (error) {
		savedViews.setState({
			notice: { kind: "error", message: `Could not save view: ${String(error)}` },
		});
	}
}

export function deleteView(colony: string, id: string): void {
	const state = savedViews.getState();
	try {
		const stored = readCollection();
		const byColony = {
			...stored,
			[colony]: (stored[colony] ?? []).filter((entry) => entry.id !== id),
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(byColony));
		savedViews.setState({
			active: { ...state.active, [colony]: "" },
			byColony,
			notice: { kind: "saved", message: "Deleted saved view. Current filters are unchanged." },
		});
	} catch (error) {
		savedViews.setState({
			notice: { kind: "error", message: `Could not delete view: ${String(error)}` },
		});
	}
}

// --- Browser storage boundary and semantic filter comparison ---
function readViews(): Pick<SavedViewsState, "byColony" | "notice"> {
	try {
		return { byColony: readCollection(), notice: { kind: "none" } };
	} catch (error) {
		return {
			byColony: {},
			notice: { kind: "error", message: `Could not load saved views: ${String(error)}` },
		};
	}
}

function readCollection(): Record<string, SavedView[]> {
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === null ? {} : collectionSchema.parse(JSON.parse(stored));
}

function filterKey(filters: FilterSet): string {
	return JSON.stringify([
		filters.query,
		filters.closed,
		filters.statuses.toSorted(),
		filters.priorities.toSorted((left, right) => left - right),
		filters.all.toSorted(),
		filters.any.toSorted(),
		filters.exclude.toSorted(),
	]);
}
