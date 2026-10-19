import { BusyBeeError, createServices } from "./native.ts";
import type { Options, Services } from "./native.ts";
import { inspectDiagram, preview } from "./preview.ts";
import type { WorkflowRunInspection } from "@hive/shared";
import { inspectLifecycle } from "./lifecycle.ts";
import { readWork } from "./runtime.ts";

const DIAGNOSTIC_LIMIT = 1000;
const FIRST = 0;

export interface InspectionSelection {
	/** Existing native workflow run ID. */
	id: string;
	/** Explicitly restore trusted author code to expand active briefs and outcome contracts. */
	work?: boolean;
	/** Explicitly load trusted author code to expand saved structure. */
	diagram?: boolean;
	/** Render labelled instruction previews within the requested diagram. */
	instructions?: boolean;
}

/** Read native truth first; requested author-code expansions have independent availability. */
export async function inspect(
	selection: InspectionSelection,
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowRunInspection> {
	if (selection.instructions && !selection.diagram) {
		throw new BusyBeeError("usage", "--instructions requires --diagram.");
	}
	const result: WorkflowRunInspection = await inspectLifecycle(selection.id, options, services);
	if (selection.work) {
		result.work = await expansion(
			() => readWork(selection.id, options, services),
			"expansion_failed",
		);
	}
	if (selection.diagram) {
		result.diagram = await requestedDiagram(selection, options, services);
	}
	return result;
}

// --- Private functions ---

async function requestedDiagram(
	selection: InspectionSelection,
	options: Options,
	services: Services,
) {
	if (selection.instructions) {
		const diagram = await expansion(
			() => inspectDiagram(selection.id, options, services),
			"diagram_unavailable",
		);
		if (diagram.kind === "available") {
			return { ...diagram, mode: "instructions" as const };
		}
		return diagram;
	}
	const diagram = await expansion(
		() => preview(selection.id, options, services),
		"diagram_unavailable",
	);
	if (diagram.kind === "available") {
		return { ...diagram, mode: "structure" as const };
	}
	return diagram;
}

async function expansion<Value>(
	operation: () => Promise<Value>,
	unavailableReason: "expansion_failed" | "diagram_unavailable",
) {
	try {
		return { kind: "available" as const, data: await operation() };
	} catch (error) {
		return unavailableExpansion(error, unavailableReason);
	}
}

function unavailableExpansion(
	error: unknown,
	unavailableReason: "expansion_failed" | "diagram_unavailable",
) {
	let reason: string = unavailableReason;
	let context: Record<string, unknown> = {};
	let message = String(error);
	if (error instanceof Error) {
		({ message } = error);
	}
	if (error instanceof BusyBeeError) {
		({ reason, context } = error);
	}
	if (unavailableReason === "diagram_unavailable") {
		message = message.slice(FIRST, DIAGNOSTIC_LIMIT);
	}
	return { kind: "unavailable" as const, reason, message, context };
}
