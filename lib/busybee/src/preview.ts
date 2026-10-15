import { BusyBeeError, createServices, readBead, resolveEndpoint } from "./native.ts";
import type { Options, Services } from "./native.ts";
import { checkpointBead, restoreDefinition } from "./runtime.ts";
import type { WorkflowPreview } from "@hive/shared";
import { previewActors } from "./definition-preview.ts";
import { readCheckpoint } from "./checkpoint.ts";

/** Read saved state and allowlisted structure without starting actors or rendering tasks. */
// eslint-disable-next-line max-statements -- Keep read-only loading, provenance and projection together.
export async function preview(
	id: string,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowPreview> {
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
	const actors = previewActors(definition.machine, run.snapshot);
	let sourceMatch: WorkflowPreview["definition"]["sourceMatch"] = "compatible";
	if (savedHash === hash) {
		sourceMatch = "exact";
	}
	return {
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
		actors,
	};
}

// --- Private functions ---

function definitionLabel(definition: { kind: "named"; name: string } | { kind: "source" }): string {
	if (definition.kind === "named") {
		return definition.name;
	}
	return "Explicit workflow";
}
