/* eslint-disable unicorn/no-null -- Settlement intent records an explicitly absent replacement. */
import {
	assertWorkflowAdmission,
	readWorkflowCompletion,
	workflowCompletion,
} from "./workflow-anchor.ts";
import { createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { BeadRecord } from "@hive/beads";
import { WORKFLOW_SETTLEMENT_PREFIX } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const record: BeadRecord = {
	id: "run",
	title: "Workflow",
	issue_type: "task",
	priority: 2,
	status: "open",
	created_at: "then",
	updated_at: "now",
	description: "",
	notes: "",
	design: "",
	acceptance_criteria: "",
	labels: [],
	comments: [],
	dependencies: [],
	dependents: [],
};
const outcomes = [
	{ outcome: "succeeded", expected: "completed" },
	{ outcome: "cancelled", expected: "cancelled" },
	{ outcome: "failed", expected: "blocked" },
] as const;

test.each(
	outcomes.flatMap((item) => [
		{
			...item,
			kind: "driver",
			scope: "run",
			id: "run" as const,
			assignment: { kind: "driver" as const, runId: "run" },
		},
		{
			...item,
			kind: "stage",
			scope: "visit",
			id: "visit" as const,
			assignment: { kind: "stage" as const, runId: "run", stageId: "visit" },
		},
	]),
)(
	"$kind completion maps native $outcome to request $expected",
	({ outcome, expected, assignment, scope, id }) => {
		const task = terminalRecord(id, outcome);
		expect(workflowCompletion(task, assignment)).toEqual({
			kind: "terminal",
			outcome: expected,
			message: `Workflow ${scope} ${id} ${outcome}: Native disposition`,
		});
	},
);

test.each([
	{ name: "legacy", close_reason: "Completed" },
	{ name: "malformed", close_reason: '{"kind":"busybee-lifecycle"}' },
	{
		name: "wrong run",
		close_reason: JSON.stringify({
			kind: "busybee-lifecycle",
			formatVersion: 1,
			scope: "run",
			runId: "other",
			outcome: "succeeded",
			reason: "Wrong",
		}),
	},
])("$name closure remains diagnostic", ({ close_reason }) => {
	expect(() =>
		workflowCompletion(
			{ ...record, status: "closed", closed_at: "now", close_reason },
			{ kind: "driver", runId: "run" },
		),
	).toThrow(Error);
});

test("a succeeded stage remains successful after later run cancellation", async () => {
	const tracker = memoryTracker();
	const runId = await createTask(tracker);
	const stageId = await createTask(tracker, { parent: runId });
	const scope = trackerScope(tracker.repository, "worker");
	await tracker.beads.close(scope, stageId, {
		reason: JSON.stringify({ ...closure("visit", "succeeded"), runId }),
	});
	await tracker.beads.close(scope, runId, {
		reason: JSON.stringify({ ...closure("run", "cancelled"), runId }),
	});
	expect(
		await readWorkflowCompletion(tracker, { kind: "stage", runId, stageId }, "worker"),
	).toMatchObject({ kind: "terminal", outcome: "completed" });
	expect(await readWorkflowCompletion(tracker, { kind: "driver", runId }, "worker")).toMatchObject({
		kind: "terminal",
		outcome: "cancelled",
	});
});

test("an open stage under a terminal run is an inconsistency", async () => {
	const tracker = memoryTracker();
	const runId = await createTask(tracker);
	await tracker.beads.close(trackerScope(tracker.repository, "worker"), runId, {
		reason: JSON.stringify({ ...closure("run", "cancelled"), runId }),
	});
	const stageId = await createTask(tracker, { parent: runId });
	await expect(
		readWorkflowCompletion(tracker, { kind: "stage", runId, stageId }, "worker"),
	).rejects.toBeInstanceOf(Error);
});

test.each(["succeeded", "cancelled", "failed"] as const)(
	"admission refuses terminal %s run",
	(outcome) => {
		expect(() => assertWorkflowAdmission(terminalRecord("run", outcome))).toThrow(Error);
	},
);

test.each([
	{
		name: "unfinished",
		notes:
			WORKFLOW_SETTLEMENT_PREFIX +
			JSON.stringify({
				owner: "publisher",
				runId: "run",
				operation: "cancel",
				reason: "Withdrawn",
				replacementId: null,
				inventory: [],
			}),
	},
	{ name: "malformed", notes: `${WORKFLOW_SETTLEMENT_PREFIX}{}` },
])("admission refuses $name settlement intent", ({ notes }) => {
	expect(() => assertWorkflowAdmission({ ...record, notes })).toThrow(Error);
});

function terminalRecord(
	id: "run" | "visit",
	outcome: "succeeded" | "cancelled" | "failed",
): BeadRecord {
	return {
		...record,
		id,
		status: "closed",
		closed_at: "now",
		close_reason: JSON.stringify(closure(id, outcome)),
	};
}

function closure(scope: "run" | "visit", outcome: "succeeded" | "cancelled" | "failed") {
	return {
		kind: "busybee-lifecycle",
		formatVersion: 1,
		scope,
		runId: "run",
		outcome,
		reason: "Native disposition",
	};
}
