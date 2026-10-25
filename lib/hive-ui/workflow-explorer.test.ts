import {
	exampleVisit,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
} from "./src/stories/workflow-explorer-data.ts";

import { expect, test } from "bun:test";

const exampleContext = exampleVisit(sampleContext, "example").snapshot.context;

test("Land worker instructions render retained evidence and the final caller brief", () => {
	const instructions = stepIds
		.filter((id) => steps[id].kind === "task")
		.map((id) => renderInstructions(id, exampleContext).instructions);
	expect(instructions.every((text) => text.includes(sampleContext.evidence))).toBe(true);
	expect(renderInstructions("done", exampleContext).instructions).toContain(sampleContext.request);
});
