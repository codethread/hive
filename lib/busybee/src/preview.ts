import { BusyBeeError, createServices, readBead, resolveEndpoint } from "./native.ts";
import type { Options, Services } from "./native.ts";
import type { WorkflowCheckpoint, WorkflowInspection, WorkflowPreview } from "@hive/shared";
import { checkpointBead, restoreDefinition } from "./runtime.ts";
import { inspectActors, previewActors } from "./definition-preview.ts";
import { readCheckpoint } from "./checkpoint.ts";

/** Read the saved checkpoint stamp without restoring or importing author code. */
export async function checkpointVersion(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowCheckpoint> {
	const endpoint = await resolveEndpoint(options, services);
	const checkpoint = await checkpointBead(endpoint, id, services);
	const run = readCheckpoint(checkpoint);
	if (run.id !== id) {
		throw new BusyBeeError(
			"invalid_checkpoint",
			`Checkpoint ${checkpoint.id} belongs to ${run.id}`,
		);
	}
	return { runId: id, checkpoint: checkpoint.id, savedAt: checkpoint.updated_at };
}

/** Read saved state and allowlisted structure without starting actors or rendering tasks. */
export async function preview(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowPreview> {
	const { projection, definition, run } = await loadSavedPreview(id, options, services);
	return { ...projection, actors: previewActors(definition.machine, run.snapshot) };
}

/** Render tooling-only instruction previews using each retained actor's saved context. */
export async function inspect(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowInspection> {
	const { projection, definition, run } = await loadSavedPreview(id, options, services);
	return {
		...projection,
		formatVersion: 1,
		actors: inspectActors(definition.machine, run.snapshot, run.active),
	};
}

// eslint-disable-next-line max-statements -- Keep read-only loading and provenance together.
export async function loadSavedPreview(id: string, options: Options, services: Services) {
	const endpoint = await resolveEndpoint(options, services);
	const [parent, checkpoint] = await Promise.all([
		readBead(endpoint, id, services),
		checkpointBead(endpoint, id, services),
	]);
	const run = readCheckpoint(checkpoint);
	if (run.id !== id) {
		throw new BusyBeeError(
			"invalid_checkpoint",
			`Checkpoint ${checkpoint.id} belongs to ${run.id}`,
		);
	}
	const savedHash = run.hash;
	const { definition, hash } = await restoreDefinition(run, endpoint, services);
	let sourceMatch: WorkflowPreview["definition"]["sourceMatch"] = "compatible";
	if (savedHash === hash) {
		sourceMatch = "exact";
	}
	const projection = {
		runId: id,
		title: parent.title,
		checkpoint: checkpoint.id,
		savedAt: checkpoint.updated_at,
		definition: {
			label: definitionLabel(run.definition),
			savedHash,
			currentHash: hash,
			sourceMatch,
		},
	};
	return { projection, definition, run };
}

// --- Private functions ---

function definitionLabel(definition: { kind: "named"; name: string } | { kind: "source" }): string {
	if (definition.kind === "named") {
		return definition.name;
	}
	return "Explicit workflow";
}
