/* eslint-disable unicorn/no-null -- Match the browser Storage boundary. */
import { boardStatuses, columnOrder, createColumnOrders, swapColumns } from "./src/column-order.ts";
import { expect, test } from "bun:test";

test("default columns preserve selected and custom statuses without showing saved absent statuses", () => {
	expect(boardStatuses(["review", "open"], [], [])).toEqual([
		"in_progress",
		"open",
		"blocked",
		"review",
	]);
	expect(boardStatuses(["review"], ["closed", "review"], ["review", "open"])).toEqual([
		"review",
		"closed",
	]);
});

test("filtered moves preserve absent columns and new statuses append in default order", () => {
	const preferred = ["review", "closed", "open", "in_progress", "blocked", "draft"];
	const moved = swapColumns(columnOrder(["open", "review"], preferred), "open", "review");
	expect(moved).toEqual(["open", "closed", "review", "in_progress", "blocked", "draft"]);
	expect(boardStatuses([], ["review", "closed", "open"], moved)).toEqual([
		"open",
		"closed",
		"review",
	]);
	expect(boardStatuses(["qa", "draft"], [], ["open"])).toEqual([
		"open",
		"in_progress",
		"blocked",
		"qa",
		"draft",
	]);
});

test("column preferences survive reload, remain per colony and reset to default", () => {
	const storage = memoryStorage();
	const first = createColumnOrders(storage);
	first.save("alpha", ["open", "blocked", "in_progress"]);
	first.save("beta", ["blocked", "open", "in_progress"]);
	const reloaded = createColumnOrders(storage);
	expect(reloaded.store.getState().byColony).toEqual({
		alpha: ["open", "blocked", "in_progress"],
		beta: ["blocked", "open", "in_progress"],
	});
	reloaded.save("alpha", []);
	const reset = createColumnOrders(storage).store.getState();
	expect(boardStatuses([], [], reset.byColony["alpha"]!)).toEqual([
		"in_progress",
		"open",
		"blocked",
	]);
	expect(reset.byColony["beta"]).toEqual(["blocked", "open", "in_progress"]);
});

test("failed storage writes remain visible and do not publish an unsaved order", () => {
	const preferences = createColumnOrders({
		getItem: () => null,
		setItem: () => {
			throw new Error("Storage unavailable");
		},
	});
	preferences.save("alpha", ["open"]);
	expect(preferences.store.getState().byColony).toEqual({});
	expect(preferences.store.getState().error).toContain("Could not save column order");
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
	const entries = new Map<string, string>();
	return {
		getItem: (key) => entries.get(key) ?? null,
		setItem: (key, value) => {
			entries.set(key, value);
		},
	};
}
