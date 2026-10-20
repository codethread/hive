import type { Detail, Hierarchy, HierarchyNode } from "../../contracts.ts";
import { OBSERVED_AT, fixtureFamily } from "./fixtures.ts";
import { workflowSamples } from "./workflow-samples.ts";

/** Model native task records; chart states without visits have no fixture bead. */
export const workflowHierarchy: Hierarchy = {
	stale: false,
	fetchedAt: OBSERVED_AT,
	nodes: [
		node("hv-keyboard", "Tighten keyboard navigation", "in_progress", null),
		node(
			"hv-keyboard.1",
			"Do work: Tighten keyboard navigation",
			"in_progress",
			"hv-keyboard",
			true,
		),
		node(
			"hv-keyboard.1.1",
			"Tighten keyboard navigation [do-work.work; visit 1]",
			"in_progress",
			"hv-keyboard.1",
			true,
		),
		node("hv-search", "Improve bead search", "in_progress", null),
		node("hv-search.1", "Do work: Explore native search", "blocked", "hv-search", true),
		node(
			"hv-search.1.1",
			"Explore native search [do-work.work; visit 1]",
			"blocked",
			"hv-search.1",
			true,
		),
		node("hv-search.2", "Do work: Implement bead search", "closed", "hv-search", true),
		node(
			"hv-search.2.1",
			"Implement bead search [do-work.work; visit 1]",
			"closed",
			"hv-search.2",
			true,
		),
		node("hv-search.3", "Do work: Review bead search", "in_progress", "hv-search", true),
		node(
			"hv-search.3.1",
			"Review bead search [do-work.work; visit 1]",
			"in_progress",
			"hv-search.3",
			true,
		),
		node("hv-release", "Ship the read-only work board", "in_progress", null),
		node("hv-release.4", "Show original work and child workflows", "in_progress", "hv-release"),
		node(
			"hv-release.4.1",
			"Do work: Show original work and child workflows",
			"in_progress",
			"hv-release.4",
			true,
		),
		node(
			"hv-release.4.1.1",
			"Show original work and child workflows [do-work.work; visit 1]",
			"in_progress",
			"hv-release.4.1",
			true,
		),
		node("hv-browser", "Verify browser navigation", "open", "hv-release.4.1"),
		node("hv-browser.1", "Do work: Verify browser navigation", "in_progress", "hv-browser", true),
		node(
			"hv-browser.1.1",
			"Verify browser navigation [do-work.work; visit 1]",
			"in_progress",
			"hv-browser.1",
			true,
		),
		node("hv-release.5", "Publish the component workshop", "open", "hv-release"),
		node("hv-release.5.1", "Check workshop links", "open", "hv-release.5"),
		// Its ID suggests another family; the explicit native parent is authoritative.
		node(
			"hv-search.8",
			"Do work: Review workflow presentation",
			"in_progress",
			"hv-release.4",
			true,
		),
		node(
			"hv-search.8.1",
			"Review workflow presentation [do-work.work; visit 1]",
			"in_progress",
			"hv-search.8",
			true,
		),
	],
};

export const singleWorkflow = fixtureFamily("hv-keyboard", workflowHierarchy);
export const multipleWorkflows = fixtureFamily("hv-search", workflowHierarchy);
export const nestedWorkflows = fixtureFamily("hv-release", workflowHierarchy);

export const previewSample = workflowSamples[0]!;
export const previewHierarchy: Hierarchy = {
	...workflowHierarchy,
	nodes: [
		...workflowHierarchy.nodes,
		{
			...workflowHierarchy.nodes[0]!,
			id: "hv-workflow-preview",
			title: "Inspect the Land workflow in Hive UI",
			parentIds: [],
		},
		{ ...previewSample.card, parentIds: ["hv-workflow-preview"] },
	],
};

export function workflowDetail(id: string, source = workflowHierarchy): Detail {
	const selected = source.nodes.find((entry) => entry.id === id)!;
	return {
		card: { ...selected, bees: [] },
		design: "",
		notes: "",
		description:
			"Original work, workflow runs and generated visits are ordinary native beads. " +
			"Use the branch explorer to follow the containing work and higher ancestors, " +
			"or open the bead outline for this scope’s descendants. " +
			"Include closed reveals completed runs and visits.",
		acceptanceCriteria:
			"- [x] Keep the native containing task and ancestors\n- [ ] Complete the selected work and verify its children",
		comments: [
			{
				id: 1,
				at: OBSERVED_AT,
				author: "ct",
				text: "Follow the native hierarchy; each shown visit is an existing task record.",
			},
		],
		dependencies: { items: [], total: 0 },
		dependents: { items: [], total: 0 },
		fetchedAt: OBSERVED_AT,
	};
}

// eslint-disable-next-line max-params -- Native fixture identity, title, status and parent remain explicit.
function node(
	id: string,
	title: string,
	status: string,
	parent: string | null,
	isWorkflowGenerated = false,
): HierarchyNode {
	return {
		id,
		isWorkflowGenerated,
		title,
		status,
		parentIds: parent === null ? [] : [parent],
		priority: 2,
		assignee: status === "in_progress" ? "amber-quiet-otter" : null,
		owner: "ct",
		beeAssignments: [],
		merges: [],
		labels: ["ui"],
		updatedAt: OBSERVED_AT,
	};
}
