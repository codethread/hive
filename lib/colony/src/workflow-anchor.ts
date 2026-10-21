import type { Bead, BeadRecord } from "@hive/beads";
import {
	nativeWorkflowState,
	parseWorkflowSettlement,
	workflowManagedExposure,
} from "@hive/shared";
import type { TrackerContext } from "./tracker.ts";
import type { WorkflowAssignment } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const ONE = 1;
const FIRST = 0;

export type WorkflowCompletion =
	| { kind: "pending" }
	| {
			kind: "terminal";
			/** Request disposition derived from its own native workflow anchor. */
			outcome: "completed" | "cancelled" | "blocked";
			/** Original workflow disposition and explanation retained for diagnostics. */
			message: string;
	  };

// eslint-disable-next-line max-statements -- Decode the captured scope and retain its native disposition together.
export function workflowCompletion(task: Bead, assignment: WorkflowAssignment): WorkflowCompletion {
	let id = assignment.runId;
	let scope: "run" | "visit" = "run";
	if (assignment.kind === "stage") {
		id = assignment.stageId;
		scope = "visit";
	}
	if (task.id !== id) {
		throw new Error(`Workflow anchor ${task.id} does not match captured assignment ${id}`);
	}
	const state = nativeWorkflowState(task, { runId: assignment.runId, scope });
	if (state.kind === "unavailable") {
		throw new Error(`Workflow anchor ${id} has an unclassified native closure`);
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
	let id = assignment.runId;
	if (assignment.kind === "stage") {
		id = assignment.stageId;
	}
	const scope = trackerScope(repository, identity);
	const completion = workflowCompletion(anchor ?? (await beads.show(scope, id)), assignment);
	if (completion.kind === "pending" && assignment.kind === "stage") {
		const run = await beads.show(scope, assignment.runId);
		const parent = workflowCompletion(run, { kind: "driver", runId: assignment.runId });
		if (parent.kind === "terminal") {
			throw new Error(`Open stage ${id} remains beneath terminal workflow ${run.id}`);
		}
	}
	return completion;
}

export function assertWorkflowAdmission(run: BeadRecord): void {
	const completion = workflowCompletion(run, { kind: "driver", runId: run.id });
	if (completion.kind === "terminal") {
		throw new Error(completion.message);
	}
	const intent = parseWorkflowSettlement(run.notes);
	if (intent !== undefined) {
		throw new Error(`Workflow ${run.id} has unfinished settlement intent for ${intent.runId}`);
	}
}

/** Native checkpoint ownership fences admission without importing workflow definitions. */
export async function readWorkflowPublication(
	{ beads, repository }: TrackerContext,
	run: BeadRecord,
	identity: string,
): Promise<{ locked: boolean; exposure: "unmanaged" | "managed" | "unknown" }> {
	const related = await beads.showMany(
		trackerScope(repository, identity),
		run.dependencies.filter((edge) => edge.dependency_type === "related").map((edge) => edge.id),
	);
	const checkpoints = related.filter(
		(record) => record.labels.includes("system") && record.labels.includes("busybee-checkpoint"),
	);
	if (checkpoints.length !== ONE) {
		throw new Error(`Workflow ${run.id} needs one native checkpoint`);
	}
	const checkpoint = checkpoints[FIRST]!;
	return { locked: checkpoint.notes !== "", exposure: workflowManagedExposure(checkpoint, run.id) };
}
