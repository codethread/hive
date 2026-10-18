import {
	WORKFLOW_ACKNOWLEDGMENT_PREFIX,
	nativeWorkflowState,
	parseWorkflowClosure,
	workflowResolution,
} from "./workflow-lifecycle.ts";
import { expect, test } from "bun:test";
import { beadSchema } from "@hive/beads";
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

test("failed workflow resolution binds both closure fields and preserves failure after replacement", () => {
	const closed = beadSchema.parse({
		id: "run-1",
		status: "closed",
		priority: 2,
		created_at: "created",
		updated_at: "closed",
		closed_at: "exact-closure",
		close_reason: JSON.stringify({ ...fact, outcome: "failed" }),
	});
	const lifecycle = nativeWorkflowState(closed, { runId: closed.id, scope: "run" });
	const comment = {
		id: 1,
		issue_id: closed.id,
		author: "operator",
		created_at: "acknowledged",
		text: `${WORKFLOW_ACKNOWLEDGMENT_PREFIX}${JSON.stringify({
			closedAt: closed.closed_at,
			closeReason: closed.close_reason,
			reason: "Accepted failure",
		})}`,
	};
	expect(workflowResolution(closed, lifecycle)).toEqual({ kind: "unresolved" });
	const acknowledged = { ...closed, comments: [comment] };
	expect(workflowResolution(acknowledged, lifecycle)).toMatchObject({
		kind: "acknowledged",
		actor: "operator",
	});
	expect(
		workflowResolution({ ...acknowledged, close_reason: `${closed.close_reason} ` }, lifecycle),
	).toEqual({ kind: "unresolved" });
	expect(workflowResolution({ ...acknowledged, closed_at: "another-closure" }, lifecycle)).toEqual({
		kind: "unresolved",
	});
	expect(
		workflowResolution(
			{
				...acknowledged,
				dependents: [{ id: "replacement", dependency_type: "supersedes" }],
			},
			lifecycle,
		),
	).toEqual({ kind: "superseded", replacementIds: ["replacement"] });
	expect(lifecycle).toMatchObject({ kind: "terminal", fact: { outcome: "failed" } });
});
