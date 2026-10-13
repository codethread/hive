import { createStore } from "zustand/vanilla";
import { z } from "zod";

const STATUS_ORDER = ["in_progress", "open", "blocked", "closed"];
const STORAGE_KEY = "hive-ui.column-order";
const collectionSchema = z.record(z.string(), z.array(z.string().min(1)));
interface ColumnOrderState {
	/** Browser-persisted status order for each configured colony. */
	byColony: Record<string, string[]>;
	/** Storage failures remain visible beside the column settings. */
	error: string;
}

/** Visible membership is unchanged; preferences order it without losing custom statuses. */
export function boardStatuses(
	present: string[],
	selected: string[],
	preferred: string[],
): string[] {
	const visible = new Set([
		...(selected.length > 0 ? selected : STATUS_ORDER.filter((status) => status !== "closed")),
		...present,
	]);
	return columnOrder([...visible], preferred).filter((status) => visible.has(status));
}

/** Retain absent statuses so filtering never discards their saved position. */
export function columnOrder(visible: string[], preferred: string[]): string[] {
	return [...new Set([...preferred, ...STATUS_ORDER, ...visible])];
}

/** Swap visible neighbours while preserving the positions of currently hidden columns. */
export function swapColumns(order: string[], status: string, neighbour: string): string[] {
	return order.map((entry) => {
		if (entry === status) {
			return neighbour;
		}
		return entry === neighbour ? status : entry;
	});
}

/** Browser storage is injected at the UI boundary; writes publish only after persistence. */
export function createColumnOrders(storage: Pick<Storage, "getItem" | "setItem">) {
	const read = (): Record<string, string[]> => {
		const stored = storage.getItem(STORAGE_KEY);
		return stored === null ? {} : collectionSchema.parse(JSON.parse(stored));
	};
	const store = createStore<ColumnOrderState>(() => {
		try {
			return { byColony: read(), error: "" };
		} catch (error) {
			return { byColony: {}, error: `Could not load column order: ${String(error)}` };
		}
	});
	const save = (colony: string, order: string[]) => {
		try {
			const byColony = { ...read(), [colony]: order };
			storage.setItem(STORAGE_KEY, JSON.stringify(byColony));
			store.setState({ byColony, error: "" });
		} catch (error) {
			store.setState({ error: `Could not save column order: ${String(error)}` });
		}
	};
	return { store, save };
}
