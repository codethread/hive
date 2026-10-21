import { expect, test } from "bun:test";
import type { SelectedBead } from "@hive/beads";
import { readHierarchy } from "./hierarchy.ts";

const rows: SelectedBead[] = [
	{ id: "root", status: "closed", dependency_count: 0, dependent_count: 1 },
	{ id: "middle", status: "closed", dependency_count: 1, dependent_count: 1 },
	{ id: "selected", status: "open", dependency_count: 1, dependent_count: 0 },
].map((row) =>
	Object.assign(row, {
		title: row.id,
		priority: 2,
		labels: [],
		created_at: "2026-10-12T00:00:00Z",
		updated_at: "2026-10-12T00:00:00Z",
		description: "",
		notes: "",
		design: "",
		acceptance_criteria: "",
		issue_type: "task",
	}),
);
const graph = {
	stale: false,
	nodes: rows,
	edges: [
		{ from: "middle", to: "root", type: "parent-child" },
		{ from: "selected", to: "middle", type: "parent-child" },
	],
	fetchedAt: "2026-10-12T00:00:00Z",
};

test.each([
	{ labels: ["bee"], status: "closed" },
	{ labels: ["merge"], status: "closed" },
	{ labels: [], status: "tombstone" },
])("excluded records cannot bridge exported ordinary families: %j", async (excluded) => {
	const disconnected = rows.map((row) => {
		const copy = structuredClone(row);
		if (row.id === "middle") {
			Object.assign(copy, excluded);
		}
		return copy;
	});
	const result = await readHierarchy(
		["root", "selected"],
		{
			graph: {
				...graph,
				nodes: disconnected,
				edges: [...graph.edges, { from: "root", to: "selected", type: "blocks" }],
			},
			rows: (ids) => Promise.resolve(disconnected.filter((row) => ids.includes(row.id))),
		},
		"family",
	);
	expect(result.map((row) => [row.bead.id, row.parentIds])).toEqual([
		["root", []],
		["selected", []],
	]);
});

test("a new seed awaiting export does not hide families already in the stale graph", async () => {
	const reads = {
		graph: { ...graph, stale: true },
		rows: (ids: string[]) => Promise.resolve(rows.filter((row) => ids.includes(row.id))),
	};
	const family = await readHierarchy(["new", "selected"], reads, "family");
	expect(family.map(({ bead }) => bead.id).toSorted()).toEqual(["middle", "root", "selected"]);
	expect(await readHierarchy(["new"], reads, "descendants")).toEqual([]);
});
