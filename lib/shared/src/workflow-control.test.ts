/* eslint-disable unicorn/no-null -- Control wire fields explicitly represent absent ownership and intent. */
/* eslint-disable max-statements -- Lookup fixture keeps its setup and observations together. */
import type { WorkflowCompletion, WorkflowControl } from "./workflow-lifecycle.ts";
import {
	WorkflowControlError,
	nativeWorkflowState,
	parseWorkflowControl,
	readWorkflowControl,
} from "./workflow-lifecycle.ts";
import { expect, test } from "bun:test";
import type { BeadRecord } from "@hive/beads";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const UNKNOWN_FORMAT = 3;
const closedAt = "2026-01-01T00:00:00Z";
const control: WorkflowControl = {
	formatVersion: 2,
	id: "run",
	lock: null,
	managedExecution: "managed",
	results: { visit: { choice: "changes", data: { choice: "payload member" } } },
	completions: {},
	settlement: null,
	created: [
		{ bead: "visit", scope: "visit" },
		{ bead: "group", scope: "group" },
	],
};
const completion: WorkflowCompletion = {
	scope: "visit",
	outcome: "succeeded",
	reason: "Readable closure.",
	state: "confirmed",
	closedAt,
};
const expected = { runId: "run", scope: "visit" } as const;
const live = { id: "visit", status: "in_progress" };
const closed = { ...live, status: "closed", closed_at: closedAt, close_reason: completion.reason };

test.each([
	{ name: "open with no directive", record: live, completions: {}, result: { kind: "pending" } },
	{
		name: "direct closure",
		record: closed,
		completions: {},
		result: { kind: "mismatch", reason: "unauthorized_closure", completion: null },
	},
	{
		name: "reopened",
		record: live,
		completions: { visit: completion },
		result: { kind: "mismatch", reason: "native_open", completion },
	},
	{
		name: "reclosed",
		record: { ...closed, closed_at: "2026-02-01T00:00:00Z" },
		completions: { visit: completion },
		result: { kind: "mismatch", reason: "closure_mismatch", completion },
	},
	{
		name: "reason edited",
		record: { ...closed, close_reason: "Other prose" },
		completions: { visit: completion },
		result: { kind: "mismatch", reason: "closure_mismatch", completion },
	},
	{
		name: "confirmed",
		record: closed,
		completions: { visit: completion },
		result: {
			kind: "terminal",
			closedAt,
			fact: { runId: "run", scope: "visit", outcome: "succeeded", reason: completion.reason },
		},
	},
])("system/native join: $name", ({ record, completions, result }) => {
	expect(nativeWorkflowState(record, expected, { ...control, completions })).toEqual(result);
});

test.each([live, closed])("requested intention is never terminal: $status", (record) => {
	const requested: WorkflowCompletion = {
		scope: "visit",
		outcome: "succeeded",
		reason: completion.reason,
		state: "requested",
	};
	expect(
		nativeWorkflowState(record, expected, { ...control, completions: { visit: requested } }),
	).toEqual({
		kind: "mismatch",
		reason: "unconfirmed_completion",
		completion: requested,
	});
});

test("stage success is its own fact beneath a later cancelled run", () => {
	const completions: WorkflowControl["completions"] = {
		visit: completion,
		run: { scope: "run", outcome: "cancelled", reason: "Retired", state: "confirmed", closedAt },
	};
	expect(nativeWorkflowState(closed, expected, { ...control, completions })).toMatchObject({
		kind: "terminal",
		fact: { outcome: "succeeded" },
	});
});

test("old-looking JSON close prose is never parsed or adopted", () => {
	const record = { ...closed, close_reason: '{"kind":"busybee-lifecycle","formatVersion":1}' };
	expect(nativeWorkflowState(record, expected, control)).toMatchObject({
		kind: "mismatch",
		reason: "unauthorized_closure",
	});
});

test.each([
	{ name: "missing generated member", created: [] },
	{ name: "scope disagreement", created: [{ bead: "visit", scope: "group" }] },
	{ name: "duplicate identity", created: [...control.created, { bead: "visit", scope: "visit" }] },
] satisfies { name: string; created: WorkflowControl["created"] }[])(
	"join rejects $name",
	({ created }) => {
		expect(() => nativeWorkflowState(live, expected, { ...control, created })).toThrow(
			WorkflowControlError,
		);
	},
);

test("join rejects run identity and completion scope disagreement", () => {
	expect(() => nativeWorkflowState(live, { ...expected, runId: "other" }, control)).toThrow(
		WorkflowControlError,
	);
	expect(() =>
		nativeWorkflowState(closed, expected, {
			...control,
			completions: { visit: { ...completion, scope: "group" } },
		}),
	).toThrow(WorkflowControlError);
});

test.each([undefined, ONE, UNKNOWN_FORMAT])(
	"unsupported format %j identifies system and run without fallback",
	(formatVersion) => {
		let failure: unknown = "No error thrown";
		try {
			parseWorkflowControl(
				{ id: "system", description: JSON.stringify({ ...control, formatVersion }) },
				"run",
			);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(WorkflowControlError);
		expect(failure).toMatchObject({
			reason: "unsupported_workflow_format",
			runId: "run",
			checkpoint: "system",
		});
	},
);

test.each([
	{ name: "wrong run", patch: { id: "other" } },
	{ name: "missing exposure", patch: { managedExecution: undefined } },
	{ name: "missing created scope", patch: { created: [{ bead: "visit" }] } },
	{
		name: "missing closure witness",
		patch: { completions: { visit: { ...completion, closedAt: undefined } } },
	},
	{ name: "invalid settlement", patch: { settlement: { operation: "cancel", reason: "Retire" } } },
	{ name: "missing original data", patch: { results: { visit: { choice: "next" } } } },
])("control boundary rejects $name", ({ patch }) => {
	expect(() =>
		parseWorkflowControl(
			{ id: "system", description: JSON.stringify({ ...control, ...patch }) },
			"run",
		),
	).toThrow(WorkflowControlError);
});

test("consumed control accepts opaque engine body and retains durable fences", () => {
	const document = {
		...control,
		lock: { owner: "invocation", pid: 42 },
		settlement: {
			operation: "cancel",
			reason: "Retire",
			state: "pending",
			inventory: [
				{ id: "visit", scope: "visit" },
				{ id: "run", scope: "run" },
			],
		},
		created: [
			{ bead: "visit", scope: "visit", node: "work", path: [], parent: "run", request: null },
		],
		snapshot: { status: "done", arbitraryEngineBody: true },
	};
	const parsed = parseWorkflowControl(
		{ id: "system", description: JSON.stringify(document) },
		"run",
	);
	expect(parsed).toMatchObject({
		lock: document.lock,
		settlement: document.settlement,
		created: [{ bead: "visit", scope: "visit" }],
	});
	expect(parsed).not.toHaveProperty("snapshot");
});

test.each([ZERO, ONE, TWO])(
	"lookup requires exactly one related system checkpoint: %s",
	async (count) => {
		const scope = { cwd: "/fixture" };
		const checkpoints = Array.from({ length: count }, (_value, index) =>
			systemRecord(`checkpoint-${index}`, ["system", "busybee-checkpoint"]),
		);
		const related = [...checkpoints, systemRecord("ordinary", ["busybee-checkpoint"])];
		const record = {
			id: "run",
			dependencies: related.map((item) => ({
				id: item.id,
				dependency_type: "related",
				title: item.title,
				status: item.status,
				priority: item.priority,
			})),
		};
		const beads = { showMany: () => Promise.resolve(related) };
		if (count === ONE) {
			const observation = await readWorkflowControl(beads, scope, record);
			expect(observation.checkpoint.id).toBe(checkpoints[ZERO]!.id);
			expect(observation.control.id).toBe(record.id);
			expect(observation.checkpoint.updated_at).toBe(checkpoints[ZERO]!.updated_at);
		} else {
			await expect(readWorkflowControl(beads, scope, record)).rejects.toBeInstanceOf(
				WorkflowControlError,
			);
		}
	},
);

// --- Private functions ---
function systemRecord(id: string, labels: string[]): BeadRecord {
	return {
		id,
		labels,
		title: "System",
		status: "open",
		priority: TWO,
		issue_type: "task",
		description: JSON.stringify(control),
		created_at: closedAt,
		updated_at: closedAt,
		notes: "Ordinary notes are not control",
		design: "",
		acceptance_criteria: "",
		dependencies: [],
		dependents: [],
		comments: [],
	};
}
