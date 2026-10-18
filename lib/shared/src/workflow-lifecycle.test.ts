import { expect, test } from "bun:test";
import { parseWorkflowClosure } from "./workflow-lifecycle.ts";
import { z } from "zod";

const fact = {
	kind: "busybee-lifecycle",
	formatVersion: 1,
	scope: "run",
	runId: "run-1",
	outcome: "succeeded",
	reason: "Workflow completed.",
} as const;

test("native lifecycle marker retains its meaning across JSON serialization", () => {
	expect(parseWorkflowClosure(JSON.stringify(fact))).toEqual(fact);
});

test.each([undefined, "Completed", '{"kind":"other"}'])(
	"unmarked historic reason %s remains unclassified",
	(reason) => {
		expect(parseWorkflowClosure(reason)).toBeUndefined();
	},
);

test.each([
	{ ...fact, formatVersion: 2 },
	{ ...fact, scope: "task" },
	{ ...fact, outcome: "done" },
	{ ...fact, runId: "" },
])("#test-78 invalid tagged facts fail at the native read boundary", (value) => {
	expect(() => parseWorkflowClosure(JSON.stringify(value))).toThrow(z.ZodError);
});
