import {
	exampleVisit,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
	transitions,
} from "./src/stories/workflow-explorer-data.ts";

import { expect, test } from "bun:test";

const exampleContext = exampleVisit(sampleContext, "example").snapshot.context;

test("Land graph shows review and delivery findings returning to checked work", () => {
	expect(stepIds).toEqual([
		"check",
		"librarian",
		"review",
		"finish",
		"verify",
		"local-update",
		"done",
	]);
	for (const stage of ["librarian", "review", "finish", "verify"] as const) {
		expect(transitions[stage].map((edge) => [edge.event, edge.target])).toContainEqual([
			"CHANGES",
			"check",
		]);
	}
	expect(steps.librarian).toMatchObject({ kind: "task", bee: "librarian" });
	expect(steps.review).toMatchObject({ kind: "task", bee: "reviewer" });
});

test("Land worker instructions render retained evidence and the final caller brief", () => {
	const instructions = stepIds
		.filter((id) => steps[id].kind === "task")
		.map((id) => renderInstructions(id, exampleContext).instructions);
	expect(instructions.every((text) => text.includes(sampleContext.evidence))).toBe(true);
	expect(renderInstructions("done", exampleContext).instructions).toContain(sampleContext.request);
});
