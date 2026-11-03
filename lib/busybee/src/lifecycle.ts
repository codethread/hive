import { BusyBeeError, createServices, resolveEndpoint } from "./native.ts";
import type { Endpoint, Options, Services } from "./native.ts";
import { nativeWorkflowState, parseWorkflowSettlement, workflowResolution } from "@hive/shared";
import type { BeadRecord } from "@hive/beads";
import type { WorkflowLifecycle } from "@hive/shared";
import { checkpointRecords } from "./runtime.ts";
import { readCheckpoint } from "./checkpoint.ts";

/** Inspect native lifecycle facts without loading a definition or creating actors. */
export async function inspectLifecycle(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowLifecycle> {
	const endpoint = await resolveEndpoint(options, services);
	return inspectLifecycleAt(id, endpoint, services);
}

/** Reuse an endpoint already selected by this invocation, with fresh native facts after publication. */
export async function inspectLifecycleAt(
	id: string,
	endpoint: Endpoint,
	services: Services,
): Promise<WorkflowLifecycle> {
	const { run: record, checkpoint } = await checkpointRecords(endpoint, id, services);
	const run = readCheckpoint(checkpoint);
	if (run.id !== id) {
		throw new BusyBeeError(
			"invalid_checkpoint",
			`Checkpoint ${checkpoint.id} belongs to ${run.id}`,
		);
	}
	const lifecycle = readLifecycle(record);
	let settlement: WorkflowLifecycle["publication"]["settlement"] = "none";
	if (parseWorkflowSettlement(record.notes)) {
		settlement = "pending";
	}
	return {
		runId: id,
		nativeStatus: record.status,
		updatedAt: record.updated_at,
		publication: {
			checkpoint: checkpoint.id,
			savedAt: checkpoint.updated_at,
			locked: checkpoint.notes !== "",
			settlement,
		},
		lifecycle,
		resolution: workflowResolution(record, lifecycle),
	};
}

// --- Private functions ---

function readLifecycle(record: BeadRecord) {
	try {
		return nativeWorkflowState(record, { runId: record.id, scope: "run" });
	} catch (error) {
		throw new BusyBeeError(
			"invalid_lifecycle",
			`Malformed native lifecycle fact on ${record.id}.`,
			{ cause: error },
		);
	}
}
