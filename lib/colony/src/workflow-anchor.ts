import type { Bead, BeadRecord } from "@hive/beads";
import type { WorkflowAssignment, WorkflowControl } from "@hive/shared";
import { nativeWorkflowState, readWorkflowControl } from "@hive/shared";
import type { TrackerContext } from "./tracker.ts";
import { trackerScope } from "./tracker.ts";

export type WorkflowCompletion =
	| { kind: "pending" }
	| {
			kind: "terminal";
			/** Request disposition derived from its own confirmed system/native anchor. */
			outcome: "completed" | "cancelled" | "blocked";
			/** Original workflow disposition and explanation retained for diagnostics. */
			message: string;
	  };

// eslint-disable-next-line max-statements -- Decode the captured scope and retain its confirmed disposition together.
export function workflowCompletion(
	task: Bead,
	assignment: WorkflowAssignment,
	control: WorkflowControl,
): WorkflowCompletion {
	let id = assignment.runId;
	let scope: "run" | "visit" = "run";
	if (assignment.kind === "stage") {
		id = assignment.stageId;
		scope = "visit";
	}
	if (task.id !== id) {
		throw new Error(`Workflow anchor ${task.id} does not match captured assignment ${id}`);
	}
	const state = nativeWorkflowState(task, { runId: assignment.runId, scope }, control);
	if (state.kind === "mismatch") {
		throw new Error(
			`Workflow anchor ${id} projection mismatch: ${state.reason}; reconcile workflow ${assignment.runId}`,
		);
	}
	if (state.kind === "pending") {
		return state;
	}
	const outcomes = { succeeded: "completed", cancelled: "cancelled", failed: "blocked" } as const;
	return {
		kind: "terminal",
		outcome: outcomes[state.fact.outcome],
		message: `Workflow ${scope} ${id} ${state.fact.outcome}: ${state.fact.reason}`,
	};
}

// eslint-disable-next-line max-statements, max-params -- Validate the anchor before considering its parent run.
export async function readWorkflowCompletion(
	{ beads, repository }: TrackerContext,
	assignment: WorkflowAssignment,
	identity: string,
	anchor?: Bead,
): Promise<WorkflowCompletion> {
	const scope = trackerScope(repository, identity);
	const run = await beads.show(scope, assignment.runId);
	const { control } = await readWorkflowControl(beads, scope, run);
	let task = anchor ?? run;
	if (assignment.kind === "stage" && anchor === undefined) {
		task = await beads.show(scope, assignment.stageId);
	}
	const completion = workflowCompletion(task, assignment, control);
	if (completion.kind === "pending" && assignment.kind === "stage") {
		const parent = workflowCompletion(run, { kind: "driver", runId: assignment.runId }, control);
		if (parent.kind === "terminal") {
			throw new Error(`Open stage ${task.id} remains beneath terminal workflow ${run.id}`);
		}
	}
	return completion;
}

/** Publication alone may cross ownership for a known generated stage, never launch/claim. */
export function assertWorkflowAdmission(
	run: BeadRecord,
	control: WorkflowControl,
	allowPublicationLock = false,
): void {
	const completion = workflowCompletion(run, { kind: "driver", runId: run.id }, control);
	if (completion.kind === "terminal") {
		throw new Error(completion.message);
	}
	if (control.settlement !== null) {
		throw new Error(`Workflow ${run.id} has durable ${control.settlement.state} settlement intent`);
	}
	if (control.lock !== null && !allowPublicationLock) {
		throw new Error(`Workflow ${run.id} publication is fenced`);
	}
}

/** Read system ownership and inventory without importing workflow definitions. */
export async function readWorkflowPublication(
	{ beads, repository }: TrackerContext,
	run: BeadRecord,
	identity: string,
) {
	const observation = await readWorkflowControl(beads, trackerScope(repository, identity), run);
	return {
		...observation,
		locked: observation.control.lock !== null,
		exposure: observation.control.managedExecution,
	};
}
