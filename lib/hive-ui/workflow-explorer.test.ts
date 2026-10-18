import { expect, test } from "bun:test";
import {
	renderInstructions,
	stepIds,
	steps,
	transitions,
} from "./src/stories/workflow-explorer-data.ts";

const exampleContext = {
	request: "Example Land request",
	target: { kind: "worktree" as const, branch: "example/land" },
	canonicalRoot: "/example/hive",
	beadsDb: "/example/hive/.beads/beads.db",
	completedTasks: [],
	expectedCommits: [],
	evidence: "Example accumulated result",
	review: undefined,
};

test("Land graph keeps distinct comment outcomes and both automatic branches", () => {
	const feedback = transitions.comments.filter((edge) => edge.target === "pr");
	expect(feedback.map((edge) => edge.event)).toEqual(["REBUTTED", "ADDRESSED"]);
	expect(new Set(feedback.map((edge) => edge.id)).size).toBe(feedback.length);
	expect(transitions.route.map((edge) => [edge.event, edge.guard, edge.target])).toEqual([
		["", "isPr", "pr"],
		["", null, "finish"],
	]);
	expect(new Set(transitions.route.map((edge) => edge.id)).size).toBe(transitions.route.length);
});

test("Land worker instructions render the same example context across the full chart", () => {
	const instructions = stepIds
		.filter((id) => steps[id].kind === "task")
		.map((id) => renderInstructions(id, exampleContext).instructions);
	expect(instructions.every((text) => text.includes("Example Land request"))).toBe(true);
	expect(instructions.every((text) => text.includes("Example accumulated result"))).toBe(true);
	expect(instructions.every((text) => text.includes("/example/hive"))).toBe(true);
});
