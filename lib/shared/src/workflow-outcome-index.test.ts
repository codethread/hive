import { expect, test } from "bun:test";
import {
	workflowManagedExposure,
	workflowOutcomeLabels,
	workflowOutcomeLabelsCurrent,
} from "./workflow-lifecycle.ts";
import type { NativeWorkflowState } from "./workflow-lifecycle.ts";

const labels = [
	"busybee-workflow",
	"team:tools",
	"workflow-outcome:failed",
	"workflow-outcome:pending",
];

test.each(["cancelled"] as const)(
	"native outcome query index replaces only its owned namespace: %s",
	(outcome) => {
		const state: NativeWorkflowState = {
			kind: "terminal",
			closedAt: "2026-01-01T00:00:00Z",
			fact: {
				kind: "busybee-lifecycle",
				formatVersion: 1,
				scope: "run",
				runId: "run",
				outcome,
				reason: "Closure",
			},
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

test.each([{ kind: "pending" }, { kind: "unavailable", reason: "unclassified_closure" }] as const)(
	"query index does not duplicate native status or invent an outcome for $kind",
	(state) => {
		expect(workflowOutcomeLabels(labels, state)).toEqual(["busybee-workflow", "team:tools"]);
		expect(workflowOutcomeLabelsCurrent(["busybee-workflow"], state)).toBe(true);
	},
);

test.each([{ formatVersion: 1, id: "other", managedExecution: "unmanaged" }])(
	"invalid exposure proof never becomes unmanaged: %j",
	(header) => {
		expect(() => workflowManagedExposure({ description: JSON.stringify(header) }, "run")).toThrow(
			Error,
		);
	},
);
