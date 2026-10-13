import type { DependencyEdge, SelectedBead } from "@hive/beads";
import { expect, test } from "bun:test";
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
const edges: DependencyEdge[] = [
	{ issue_id: "middle", depends_on_id: "root" },
	{ issue_id: "selected", depends_on_id: "middle" },
].map((edge) =>
	Object.assign(edge, { type: "parent-child", title: "Related", status: "closed", priority: 2 }),
);

test("complete family traversal retains closed intermediate ancestors and descendants", async () => {
	const reads = {
		rows: (ids: string[]) => Promise.resolve(rows.filter((row) => ids.includes(row.id))),
		edges: (id: string) =>
			Promise.resolve(edges.filter((edge) => edge.issue_id === id || edge.depends_on_id === id)),
	};
	const family = await readHierarchy(["selected"], reads, "family");
	const descendants = await readHierarchy(["middle"], reads, "descendants");
	expect(family.map(({ bead }) => bead.id).toSorted()).toEqual(["middle", "root", "selected"]);
	expect(descendants.map(({ bead, parentIds }) => [bead.id, parentIds])).toEqual([
		["middle", ["root"]],
		["selected", ["middle"]],
	]);
});
