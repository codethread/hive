import { expect, test } from "bun:test";
import { workflowOutcomeLabels, workflowOutcomeLabelsCurrent } from "./workflow-lifecycle.ts";
import type { NativeWorkflowState } from "./workflow-lifecycle.ts";

const labels = [
	"busybee-workflow",
	"team:tools",
	"workflow-outcome:failed",
	"workflow-outcome:pending",
];

test.each(["succeeded", "failed", "cancelled"] as const)(
	"system outcome query index replaces only its owned namespace: %s #test-741",
	(outcome) => {
		const state: NativeWorkflowState = {
			kind: "terminal",
			closedAt: "2026-01-01T00:00:00Z",
			fact: { scope: "run", runId: "run", outcome, reason: "Closure" },
		};
		const indexed = ["busybee-workflow", "team:tools", `workflow-outcome:${outcome}`];
		expect(workflowOutcomeLabels(labels, state)).toEqual(indexed);
		expect(workflowOutcomeLabelsCurrent(labels, state)).toBe(false);
		expect(workflowOutcomeLabelsCurrent(indexed, state)).toBe(true);
		expect(workflowOutcomeLabelsCurrent([...indexed, `workflow-outcome:${outcome}`], state)).toBe(
			false,
		);
	},
);

test.each([
	{ kind: "pending" },
	// eslint-disable-next-line unicorn/no-null -- A direct native closure has no system completion.
	{ kind: "mismatch", reason: "unauthorized_closure", completion: null },
] as const)("query index does not invent an outcome for $kind", (state) => {
	expect(workflowOutcomeLabels(labels, state)).toEqual(["busybee-workflow", "team:tools"]);
	expect(workflowOutcomeLabelsCurrent(["busybee-workflow"], state)).toBe(true);
});
