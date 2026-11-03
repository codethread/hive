import type { WorkflowInspection, WorkflowLifecycle, WorkflowView } from "../../contracts.ts";

/** Synthetic native facts are explicit and never inferred from an actor's final state. */
export function sampleLifecycle(
	inspection: Pick<WorkflowInspection, "runId" | "checkpoint" | "savedAt">,
): WorkflowLifecycle {
	return {
		runId: inspection.runId,
		nativeStatus: "in_progress",
		updatedAt: inspection.savedAt,
		publication: {
			checkpoint: inspection.checkpoint,
			savedAt: inspection.savedAt,
			locked: false,
			settlement: "none",
		},
		lifecycle: { kind: "pending" },
		resolution: { kind: "unresolved" },
	};
}

export function sampleWorkflowView(
	inspection: WorkflowInspection,
	native = sampleLifecycle(inspection),
): WorkflowView {
	return { ...native, diagram: { kind: "available", mode: "instructions", data: inspection } };
}
