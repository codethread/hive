import { BusyBeeError, createServices, resolveEndpoint } from "./native.ts";
import type { Options, Services } from "./native.ts";
import type { BeadRecord } from "@hive/beads";
import type { WorkflowLifecycle } from "@hive/shared";
import { checkpointRecords } from "./runtime.ts";
import { parseWorkflowClosure } from "@hive/shared";
import { readCheckpoint } from "./checkpoint.ts";

/** Inspect native lifecycle facts without loading a definition or creating actors. */
export async function inspectLifecycle(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowLifecycle> {
	const endpoint = await resolveEndpoint(options, services);
	const { run: record, checkpoint } = await checkpointRecords(endpoint, id, services);
	const run = readCheckpoint(checkpoint);
	if (run.id !== id) {
		throw new BusyBeeError(
			"invalid_checkpoint",
			`Checkpoint ${checkpoint.id} belongs to ${run.id}`,
		);
	}
	return {
		runId: id,
		nativeStatus: record.status,
		updatedAt: record.updated_at,
		publication: {
			checkpoint: checkpoint.id,
			savedAt: checkpoint.updated_at,
			locked: checkpoint.notes !== "",
		},
		lifecycle: nativeLifecycle(record),
	};
}

// --- Private functions ---

function nativeLifecycle(record: BeadRecord): WorkflowLifecycle["lifecycle"] {
	const { id } = record;
	const fact = readClosure(record);
	if (
		fact &&
		(record.status !== "closed" || !record.closed_at || fact.scope !== "run" || fact.runId !== id)
	) {
		throw new BusyBeeError("invalid_lifecycle", `Native closure fact disagrees with run ${id}.`);
	}
	if (record.status === "closed") {
		if (fact) {
			return { kind: "terminal", closedAt: record.closed_at!, fact };
		}
		return { kind: "unavailable", reason: "unclassified_closure" };
	}
	return { kind: "pending" };
}

function readClosure(record: BeadRecord) {
	try {
		return parseWorkflowClosure(record.close_reason);
	} catch (error) {
		throw new BusyBeeError(
			"invalid_lifecycle",
			`Malformed native lifecycle fact on ${record.id}.`,
			{ cause: error },
		);
	}
}
