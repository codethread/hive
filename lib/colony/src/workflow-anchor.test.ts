/* eslint-disable unicorn/no-null -- System control explicitly represents absent locks and settlement. */
import type { WorkflowAssignment, WorkflowControl } from "@hive/shared";
import { eligibility, launchFence } from "./launch.ts";
import { expect, test } from "bun:test";
import { readWorkflowCompletion, workflowCompletion } from "./workflow-anchor.ts";
import type { ExecutionClearanceRuntime } from "./execution-clearance.ts";
import { WorkflowControlError } from "@hive/shared";
import { acquireClaim } from "./claims.ts";
import { executionClearance } from "./execution-clearance.ts";
import { workflowFixture } from "./workflow.test-support.ts";

const PID = 123;
const IDS = 1;
const OBSERVED = "2026-10-25T00:00:00Z";
const CLOSED_AT = "closed-revision";
const outcomes = [
	{ outcome: "succeeded", request: "completed" },
	{ outcome: "failed", request: "blocked" },
	{ outcome: "cancelled", request: "cancelled" },
] as const;
const succeeded = {
	scope: "run",
	outcome: "succeeded",
	reason: "Readable completion",
	state: "confirmed",
	closedAt: CLOSED_AT,
} as const;

test.each([...outcomes])(
	"confirmed $outcome stage retains its outcome beneath a cancelled run",
	async ({ outcome, request }) => {
		const fixture = workflowFixture({
			completions: {
				stage: { ...succeeded, scope: "visit", outcome },
				run: { ...succeeded, outcome: "cancelled" },
			},
		});
		Object.assign(fixture.stage, {
			status: "closed",
			closed_at: CLOSED_AT,
			close_reason: succeeded.reason,
			labels: ["workflow-outcome:failed"],
		});
		Object.assign(fixture.run, {
			status: "closed",
			closed_at: CLOSED_AT,
			close_reason: succeeded.reason,
		});
		const assignment: WorkflowAssignment = { kind: "stage", runId: "run", stageId: "stage" };
		const completion = await readWorkflowCompletion(fixture, assignment, "worker");
		expect(completion).toMatchObject({ kind: "terminal", outcome: request });
		expect(eligibility([fixture.stage], [], "worker", completion)).toMatchObject({
			kind: "finished",
			outcome: request,
		});
		expect(
			await readWorkflowCompletion(fixture, { kind: "driver", runId: "run" }, "worker"),
		).toMatchObject({ kind: "terminal", outcome: "cancelled" });
	},
);

test.each(["requested", "reopened", "reclosed", "reason", "unauthorized"] as const)(
	"%s anchor cannot become successful or executable from native closure/prose",
	// eslint-disable-next-line max-statements -- Build each projection mismatch against one typed native observation.
	(variant) => {
		const fixture = workflowFixture({ completions: { run: succeeded } });
		Object.assign(fixture.run, {
			status: "closed",
			closed_at: CLOSED_AT,
			close_reason: succeeded.reason,
			notes: '{"choice":"next","data":{}}',
		});
		if (variant === "requested") {
			fixture.control.completions["run"] = {
				scope: "run",
				outcome: "succeeded",
				reason: succeeded.reason,
				state: "requested",
			};
		} else if (variant === "unauthorized") {
			delete fixture.control.completions["run"];
		} else if (variant === "reopened") {
			fixture.run.status = "open";
		} else if (variant === "reclosed") {
			fixture.run.closed_at = "another-close";
		} else if (variant === "reason") {
			fixture.run.close_reason = "Different prose";
		}
		expect(() =>
			workflowCompletion(fixture.run, { kind: "driver", runId: "run" }, fixture.control),
		).toThrow(Error);
	},
);

test("unsupported system formats fail explicitly even with old-looking notes and closed anchors", async () => {
	const fixture = workflowFixture();
	Object.assign(fixture.run, { status: "closed", notes: '{"choice":"next","data":{}}' });
	fixture.checkpoint.description = JSON.stringify({
		formatVersion: 1,
		id: "run",
		managedExecution: "managed",
	});
	await expect(
		readWorkflowCompletion(fixture, { kind: "driver", runId: "run" }, "worker"),
	).rejects.toBeInstanceOf(WorkflowControlError);
});

test.each(["lock", "settlement", "unmanaged"] as const)(
	"%s fences claim and launch without altering work",
	// eslint-disable-next-line max-statements -- Compare both admission boundaries with the same native facts.
	async (fence) => {
		const control: Partial<WorkflowControl> = {};
		if (fence === "lock") {
			control.lock = { owner: "busybee-writer", pid: PID };
		} else if (fence === "settlement") {
			control.settlement = {
				operation: "cancel",
				reason: "Stop",
				state: "pending",
				inventory: [{ id: "run", scope: "run" }],
			};
		} else {
			control.managedExecution = "unmanaged";
		}
		const fixture = workflowFixture(control);
		const before = structuredClone(fixture.run);
		const assignment = { kind: "driver", runId: "run" } as const;
		await expect(
			acquireClaim(fixture, { identity: "worker", assignment }, "run", {
				step: () => {},
				completed: () => {},
				failed: () => {},
				reference: () => {},
			}),
		).rejects.toBeInstanceOf(Error);
		const launch = launchFence(
			{ ...fixture.repository, beads: fixture.beads },
			assignment,
			"worker",
		);
		if (fence === "lock") {
			expect(await launch).toBeTypeOf("string");
		} else {
			await expect(launch).rejects.toBeInstanceOf(Error);
		}
		expect(fixture.run).toEqual(before);
	},
);

test("pending stage beneath a terminal run fails rather than borrowing the parent's result", async () => {
	const fixture = workflowFixture({ completions: { run: { ...succeeded, outcome: "cancelled" } } });
	Object.assign(fixture.run, {
		status: "closed",
		closed_at: CLOSED_AT,
		close_reason: succeeded.reason,
	});
	await expect(
		readWorkflowCompletion(fixture, { kind: "stage", runId: "run", stageId: "stage" }, "worker"),
	).rejects.toBeInstanceOf(Error);
});

test.each(["closed", "open"])(
	"final launch fence rechecks a confirmed stage with native status %s",
	async (status) => {
		const fixture = workflowFixture({ completions: { stage: { ...succeeded, scope: "visit" } } });
		Object.assign(fixture.stage, { status, closed_at: CLOSED_AT, close_reason: succeeded.reason });
		const result = launchFence(
			{ ...fixture.repository, beads: fixture.beads },
			{ kind: "stage", runId: "run", stageId: "stage" },
			"worker",
		);
		if (status === "closed") {
			expect(await result).toBeTypeOf("string");
		} else {
			await expect(result).rejects.toBeInstanceOf(Error);
		}
	},
);

test.each([
	{ control: { lock: null }, reason: "admission_not_fenced" },
	{ control: { settlement: null }, reason: "admission_not_fenced" },
] as const)("clearance refuses missing system fence $control", async ({ control, reason }) => {
	const { runtime, run, stage } = clearanceFixture(control);
	const observed = await executionClearance({ runId: run, anchorIds: [run, stage] }, runtime);
	expect(observed.result).toMatchObject({ kind: "refused", blockers: [{ reason }] });
});

test("clearance cannot omit a generated stage from the system inventory", async () => {
	const { runtime, run } = clearanceFixture();
	const observed = await executionClearance({ runId: run, anchorIds: [run] }, runtime);
	expect(observed.result).toMatchObject({
		kind: "refused",
		blockers: [{ reason: "invalid_system_inventory" }],
	});
});

test("clearance rejects a changed system checkpoint even when native anchors stay unchanged", async () => {
	const { runtime, run, stage, checkpoint } = clearanceFixture();
	const { beads } = runtime;
	const changed = {
		...runtime,
		beads: {
			...beads,
			showMany: (...args: Parameters<typeof beads.showMany>) => {
				if (args[IDS].includes(run) && args[IDS].includes(checkpoint.id)) {
					checkpoint.updated_at = "new-system-revision";
				}
				return beads.showMany(...args);
			},
		},
	};
	const observed = await executionClearance({ runId: run, anchorIds: [run, stage] }, changed);
	expect(observed.result).toMatchObject({
		kind: "refused",
		blockers: [{ reason: "native_scope_changed" }],
	});
});

// --- Clearance observation fixture ---
function clearanceFixture(input: Partial<WorkflowControl> = {}) {
	const context = workflowFixture({
		lock: { owner: "busybee-settler", pid: PID },
		settlement: {
			operation: "cancel",
			reason: "Stop",
			state: "pending",
			inventory: [
				{ id: "stage", scope: "visit" },
				{ id: "run", scope: "run" },
			],
		},
		...input,
	});
	const runtime: ExecutionClearanceRuntime = {
		...context,
		registered: true,
		host: "owning-host",
		now: () => OBSERVED,
		withAdmission: (operation) => operation(),
		store: { requests: () => [], request: () => {}, retainedInventory: () => [] },
		observe: () => {
			throw new Error("No managed attempts exist in this fixture");
		},
	};
	return { runtime, run: context.run.id, stage: context.stage.id, checkpoint: context.checkpoint };
}
