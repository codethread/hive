import { expect, test } from "bun:test";
import { fixtureFamily, fixtureOutline } from "./src/stories/fixtures.ts";
import { workflowHierarchy } from "./src/stories/workflow-fixtures.ts";

test.each([
	["hv-ui", ["hv-ui", "hv-ui.1", "hv-ui.2", "hv-ui.3", "hv-ui.4"]],
	["hv-ui.1", ["hv-ui.1"]],
	["hv-rails", ["hv-rails", "hv-rails.1", "hv-rails.2"]],
])("outline fixture for %s contains only its descendants", (id, ids) => {
	expect(fixtureOutline(id).nodes.map((node) => node.id)).toEqual(ids);
});

test("workflow outlines preserve containing work and supporting workflows at every native depth", () => {
	const outline = fixtureOutline("hv-release.4", workflowHierarchy);
	expect(outline.nodes.map((node) => node.id)).toEqual([
		"hv-release.4",
		"hv-release.4.1",
		"hv-release.4.1.1",
		"hv-browser",
		"hv-browser.1",
		"hv-browser.1.1",
		"hv-search.8",
		"hv-search.8.1",
	]);
	const family = fixtureFamily("hv-search.8.1", workflowHierarchy);
	expect(family.nodes[0]!.id).toBe("hv-release");
	expect(family.nodes.find((node) => node.id === "hv-search.8")!.parentIds).toEqual([
		"hv-release.4",
	]);
	expect(family.nodes.some((node) => node.id === "hv-release.5.1")).toBe(true);
	expect(family.nodes.some((node) => node.id === "hv-search")).toBe(false);
});

test("multiple workflow fixtures retain both completed work and an unfinished older attempt", () => {
	const family = fixtureFamily("hv-search.3.1", workflowHierarchy);
	expect(family.nodes.map((node) => [node.id, node.status])).toEqual([
		["hv-search", "in_progress"],
		["hv-search.1", "blocked"],
		["hv-search.1.1", "blocked"],
		["hv-search.2", "closed"],
		["hv-search.2.1", "closed"],
		["hv-search.3", "in_progress"],
		["hv-search.3.1", "in_progress"],
	]);
});

test("workflow fixtures mark generated work while preserving agent-created supporting tasks", () => {
	expect(
		workflowHierarchy.nodes.filter((node) => node.isWorkflowGenerated).map((node) => node.id),
	).toEqual([
		"hv-keyboard.1",
		"hv-keyboard.1.1",
		"hv-search.1",
		"hv-search.1.1",
		"hv-search.2",
		"hv-search.2.1",
		"hv-search.3",
		"hv-search.3.1",
		"hv-release.4.1",
		"hv-release.4.1.1",
		"hv-browser.1",
		"hv-browser.1.1",
		"hv-search.8",
		"hv-search.8.1",
	]);
});
