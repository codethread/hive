import type { Board, Hierarchy, HierarchyNode } from "./contracts.ts";
import {
	beadFamilies,
	boardFamilies,
	branchRows,
	hasHierarchy,
	outlineHierarchy,
} from "./hierarchy.ts";
import { expect, test } from "bun:test";

const COMPONENT_COUNT = 2;
const SHARED_INDEX = 2;
const RUN_DEPTH = 2;
const VISIT_DEPTH = 3;

function makeNode(id: string, status = "open", parentIds: string[] = []): HierarchyNode {
	return {
		id,
		title: id,
		status,
		parentIds,
		priority: 2,
		assignee: null,
		beeAssignments: [],
		isWorkflowGenerated: false,
		labels: [],
		updatedAt: "2026-10-12T00:00:00Z",
	};
}
function board(nodes: HierarchyNode[]): Board {
	return { cards: nodes, fetchedAt: "2026-10-12T00:00:00Z", hasMore: false, labels: [], query: [] };
}

test.each([
	{ statuses: ["closed", "open"], expected: "ordinary" },
	{ statuses: ["open", "open", "open"], expected: "rails" },
	{ statuses: ["open", "open", "open", "open"], expected: "swimlane" },
	{ statuses: ["open", "in_review"], expected: "swimlane" },
	{ statuses: ["open", "closed", "tombstone", "open"], expected: "rails" },
])("adaptive family uses complete unclosed membership: $statuses", ({ statuses, expected }) => {
	const root = makeNode("root", "closed");
	const nodes = [
		root,
		...statuses.map((status, index) => makeNode(`child-${index}`, status, [root.id])),
	];
	const hierarchy = { nodes, fetchedAt: root.updatedAt };
	const [family] = boardFamilies(board([nodes[1]!]), hierarchy);
	expect(family!.layout).toBe(expected);
	expect(family!.visible.map(({ node }) => node.id)).toEqual(["child-0"]);
});

test("current card status controls both family layout and native lane placement", () => {
	const root = makeNode("root");
	const child = makeNode("child", "open", [root.id]);
	const current = { ...child, status: "in_review" };
	const [family] = boardFamilies(board([root, current]), {
		nodes: [root, child],
		fetchedAt: root.updatedAt,
	});
	expect(family!.layout).toBe("swimlane");
	expect(family!.visible.map(({ node }) => node.status)).toEqual(["open", "in_review"]);
});

test.each([
	{ name: "open intermediate", middle: [makeNode("hv-ezgh1.9", "open", ["hv-ezgh1"])] },
	{ name: "closed intermediate", middle: [makeNode("hv-ezgh1.9", "closed", ["hv-ezgh1"])] },
	{ name: "missing intermediate", middle: [] },
])("board families bridge dotted-ID gaps: $name", ({ middle }) => {
	const root = makeNode("hv-ezgh1", "in_progress");
	const child = makeNode("hv-ezgh1.9.1", "blocked");
	const nodes = [child, root, ...middle];
	const hierarchy = { nodes, fetchedAt: root.updatedAt };
	const families = boardFamilies(board([child, root]), hierarchy);
	expect(
		families.map((family) => ({
			root: family.root.id,
			layout: family.layout,
			visible: family.visible.map(({ node }) => [node.id, node.status, node.parentIds]),
		})),
	).toEqual([
		{
			root: root.id,
			layout: "swimlane",
			visible: [
				[root.id, "in_progress", []],
				[child.id, "blocked", []],
			],
		},
	]);
	// Board presentation must not infer relationships in native outlines or cached snapshots.
	expect(beadFamilies(hierarchy)).toHaveLength(COMPONENT_COUNT);
	expect(branchRows(hierarchy, root).map(({ node }) => node.id)).toEqual([
		root.id,
		...middle.map((node) => node.id),
	]);
});

test("board grouping respects ID segment boundaries and retains non-dotted native descendants", () => {
	const root = makeNode("hv-work.1", "open");
	const nested = makeNode("hv-work.1.2", "blocked");
	const native = makeNode("hv-other", "open", [nested.id]);
	const separate = makeNode("hv-work.10", "open");
	const nodes = [root, nested, native, separate];
	const families = boardFamilies(board(nodes), { nodes, fetchedAt: root.updatedAt });
	expect(families.map((family) => family.visible.map(({ node }) => node.id))).toEqual([
		[root.id, nested.id, native.id],
		[separate.id],
	]);
});

test("dotted bridges through non-root members join whole native families transitively", () => {
	const root = makeNode("hv-root", "in_progress");
	const middle = makeNode("hv-branch", "closed", [root.id]);
	const branch = makeNode("hv-branch.2", "closed");
	const nested = makeNode("hv-nested", "closed", [branch.id]);
	const leaf = makeNode("hv-nested.3", "blocked");
	const nodes = [leaf, nested, branch, middle, root];
	const families = boardFamilies(board([root, leaf]), { nodes, fetchedAt: root.updatedAt });
	expect(
		families.map((family) => ({
			root: family.root.id,
			members: family.rows.map(({ node }) => node.id),
			visible: family.visible.map(({ node }) => node.id),
		})),
	).toEqual([
		{
			root: root.id,
			members: [root.id, middle.id, branch.id, nested.id, leaf.id],
			visible: [root.id, leaf.id],
		},
	]);
});

test.each([
	{
		name: "loaded native parent",
		loaded: true,
		expected: [
			[
				["hv-scope", 0],
				["hv-work", 1],
				["hv-other.1", RUN_DEPTH],
				["hv-visit", VISIT_DEPTH],
			],
			[["hv-other", 0]],
		],
	},
	{
		name: "unloaded native parent",
		loaded: false,
		expected: [
			[
				["hv-other.1", 0],
				["hv-visit", 1],
			],
			[["hv-other", 0]],
		],
	},
])("explicit parents override conflicting dotted ancestry: $name", ({ loaded, expected }) => {
	let nodes = [
		makeNode("hv-scope", "in_progress"),
		makeNode("hv-work", "in_progress", ["hv-scope"]),
		makeNode("hv-other.1", "in_progress", ["hv-work"]),
		makeNode("hv-visit", "in_progress", ["hv-other.1"]),
		makeNode("hv-other", "open"),
	];
	if (!loaded) {
		nodes = nodes.filter((node) => node.id !== "hv-scope" && node.id !== "hv-work");
	}
	const hierarchy = { nodes, fetchedAt: nodes[0]!.updatedAt };
	const families = boardFamilies(board(nodes), hierarchy);
	expect(families.map((family) => family.rows.map(({ node, depth }) => [node.id, depth]))).toEqual(
		expected.map((family) => family.map((row) => [...row])),
	);
	expect(families.flatMap((family) => family.rows.map(({ node }) => node.parentIds))).toEqual(
		nodes.map((node) => node.parentIds),
	);
});

test("native shared children and rootless components appear once without truncating descendants", () => {
	const nodes = [
		makeNode("a"),
		makeNode("b"),
		makeNode("shared", "closed", ["a", "b"]),
		makeNode("nested", "open", ["shared"]),
		makeNode("cycle-a", "open", ["cycle-b"]),
		makeNode("cycle-b", "open", ["cycle-a"]),
	];
	const hierarchy: Hierarchy = { nodes, fetchedAt: nodes[0]!.updatedAt };
	const families = beadFamilies(hierarchy);
	expect(families).toHaveLength(COMPONENT_COUNT);
	expect(families.flatMap((family) => family.rows.map(({ node }) => node.id)).toSorted()).toEqual(
		nodes.map((node) => node.id).toSorted(),
	);
	expect(branchRows(hierarchy, nodes[SHARED_INDEX]!).map(({ node }) => node.id)).toEqual([
		"shared",
		"nested",
	]);
});

test("outline closed visibility preserves selected beads and native paths to active descendants", () => {
	const nodes = [
		makeNode("root", "closed"),
		makeNode("parent", "closed", ["root"]),
		makeNode("active", "open", ["parent"]),
		makeNode("closed", "closed", ["root"]),
		makeNode("deleted", "tombstone", ["root"]),
	];
	const hierarchy = { nodes, fetchedAt: nodes[0]!.updatedAt };
	expect(outlineHierarchy(hierarchy, false, "root").nodes.map((node) => node.id)).toEqual([
		"root",
		"parent",
		"active",
	]);
	expect(outlineHierarchy(hierarchy, false, "closed").nodes.map((node) => node.id)).toEqual([
		"root",
		"parent",
		"active",
		"closed",
	]);
	expect(outlineHierarchy(hierarchy, true, "root").nodes).toEqual(nodes);
});

test.each([
	{ name: "standalone open bead", nodes: [makeNode("bead")], expected: false },
	{ name: "standalone closed bead", nodes: [makeNode("bead", "closed")], expected: false },
	{ name: "sub-bead", nodes: [makeNode("bead", "open", ["parent"])], expected: true },
	{
		name: "parent of a closed bead",
		nodes: [makeNode("bead"), makeNode("child", "closed", ["bead"])],
		expected: true,
	},
])("inspector outline availability uses native relationships: $name", ({ nodes, expected }) => {
	expect(hasHierarchy({ nodes: [...nodes], fetchedAt: nodes[0].updatedAt }, "bead")).toBe(expected);
});
