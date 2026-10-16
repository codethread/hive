import { expect, test } from "bun:test";
import type { SelectedBead } from "@hive/beads";
import { readHierarchy } from "./hierarchy.ts";

const BATCH_SIZE = 100;
const FAMILY_SIZE = BATCH_SIZE + 1;
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
	nodes: rows,
	edges: [
		{ from: "middle", to: "root", type: "parent-child" },
		{ from: "selected", to: "middle", type: "parent-child" },
	],
	fetchedAt: "2026-10-12T00:00:00Z",
};

test("complete family traversal retains closed intermediate ancestors and descendants", async () => {
	const reads = {
		graph,
		rows: (ids: string[]) => Promise.resolve(rows.filter((row) => ids.includes(row.id))),
	};
	const family = await readHierarchy(["selected"], reads, "family");
	const descendants = await readHierarchy(["middle"], reads, "descendants");
	expect(family.map(({ bead }) => bead.id).toSorted()).toEqual(["middle", "root", "selected"]);
	expect(descendants.map(({ bead, parentIds }) => [bead.id, parentIds])).toEqual([
		["middle", ["root"]],
		["selected", ["middle"]],
	]);
});

test("graph discovery batches native rows after finding the complete component", async () => {
	const many = Array.from({ length: FAMILY_SIZE }, (_unused, index) => ({
		...rows[0]!,
		id: `node-${index}`,
	}));
	const batches: number[] = [];
	const result = await readHierarchy(
		[many[0]!.id],
		{
			graph: {
				nodes: many,
				edges: many
					.slice(1)
					.map((node) => ({ from: node.id, to: many[0]!.id, type: "parent-child" })),
				fetchedAt: graph.fetchedAt,
			},
			rows: (ids) => {
				batches.push(ids.length);
				return Promise.resolve(many.filter((row) => ids.includes(row.id)));
			},
		},
		"family",
	);
	expect(result).toHaveLength(FAMILY_SIZE);
	expect(batches).toEqual([BATCH_SIZE, 1]);
});

test.each([
	{ labels: ["system"], status: "closed" },
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

test.each([
	{ name: "missing-seed", ids: ["absent"] },
	{ name: "missing-row", ids: ["root"] },
])("$name is a visible hierarchy failure", async ({ ids }) => {
	const result = await readHierarchy(
		[...ids],
		{ graph, rows: () => Promise.resolve([]) },
		"family",
	).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
});
