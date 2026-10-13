import type { Hierarchy, HierarchyNode } from "./contracts.ts";
import { createHierarchyResource, snapshot } from "./src/data.ts";
import { expect, test } from "bun:test";
import { hierarchyKey } from "./contracts.ts";

const OLD = "2026-10-12T00:00:00Z";
const NEW = "2026-10-12T00:00:01Z";
const left = node("left");
const right = node("right");
const original = { nodes: [left, right, node("child", ["left"])], fetchedAt: OLD };
const moved = { nodes: [right, node("child", ["right"])], fetchedAt: NEW };

test("an older board response cannot republish a family after a newer member refresh", async () => {
	const old = Promise.withResolvers<Hierarchy>();
	const resource = createHierarchyResource((path) => {
		if (path === "old") {
			return old.promise;
		}
		return Promise.resolve(moved);
	});
	const pending = resource.load(key(["left", "right"]), "old");
	await resource.load(key(["right"]), "new", true);
	old.resolve(original);
	await pending;
	expect(resource.store.getState().entries[key(["left", "right"])]?.kind).toBe("stale");
	expect(snapshot(resource.store.getState().entries[key(["child"])]!)?.nodes).toEqual(moved.nodes);
});

test.each(["success", "failure"])(
	"an older member %s preserves a newer complete alias",
	async (outcome) => {
		const old = Promise.withResolvers<Hierarchy>();
		const resource = createHierarchyResource((path) => {
			if (path === "old") {
				return old.promise;
			}
			return Promise.resolve(moved);
		});
		const pending = resource.load(key(["child"]), "old");
		await resource.load(key(["right"]), "new", true);
		if (outcome === "success") {
			old.resolve(original);
		} else {
			old.reject(new Error("Old read failed"));
		}
		await pending;
		expect(resource.store.getState().entries[key(["child"])]?.kind).toBe("ready");
		expect(snapshot(resource.store.getState().entries[key(["child"])]!)?.nodes).toEqual(
			moved.nodes,
		);
	},
);

function key(ids: string[]): string {
	return hierarchyKey("colony", ids);
}

function node(id: string, parentIds: string[] = []): HierarchyNode {
	return {
		id,
		title: id,
		parentIds,
		status: "open",
		priority: 2,
		assignee: null,
		beeAssignments: [],
		labels: [],
		updatedAt: OLD,
	};
}
