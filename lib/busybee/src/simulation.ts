import type { AnyMachineSnapshot, AnyStateMachine } from "xstate";
import { BusyBeeError, createServices } from "./native.ts";
import type { Definition, ResolvedTask, WorkflowNode } from "./definition.ts";
import type { Options, Services } from "./native.ts";
import type { WorkflowSimulation, WorkflowSimulationRequest } from "@hive/shared";
import {
	advanceSimulation,
	finalSimulation,
	initialSimulation,
	savedSimulation,
	simulationMachine,
	unsupportedSimulation,
} from "./simulation-machine.ts";
import { metadataSchema, renderTask } from "./definition.ts";
import {
	publishedTaskInstruction,
	renderNodeInstructions,
	renderedTaskInstruction,
	retainedActors,
} from "./definition-preview.ts";
import type { ActiveEntry } from "./checkpoint.ts";
import { loadSavedPreview } from "./preview.ts";
import { z } from "zod";

const FIRST = 0;
const FORMAT_VERSION = 1;
interface VirtualVisit {
	/** Commands and title frozen for this real or simulated visit. */
	meta: ResolvedTask;
	/** Real native identity exists only for untouched published visits. */
	validation: { kind: "published"; entry: ActiveEntry } | { kind: "simulated" };
}
type Visits = Map<string, VirtualVisit>;

/** Stateless, read-only replay: no runtime actor restoration or native publication. */
// eslint-disable-next-line max-statements -- Keep the read/verify/replay projection boundary in one operation.
export async function simulate(
	input: { id: string; request: WorkflowSimulationRequest },
	options: Options = {},
	services: Services = createServices(),
): Promise<WorkflowSimulation> {
	const { id, request } = input;
	const { projection, definition, run } = await loadSavedPreview(id, options, services);
	assertBaseline(request, projection);
	const retained = retainedActors(definition.machine, run.snapshot).find(
		(actor) => actor.projection.id === request.actorId,
	);
	if (!retained) {
		throw new BusyBeeError(
			"simulation_actor_missing",
			`Retained actor ${request.actorId} is unavailable`,
		);
	}
	const machine = simulationMachine(retained.machine);
	const { path } = retained.projection;
	let snapshot = startingSnapshot({
		machine,
		definition,
		start: request.start,
		saved: retained.saved,
		path,
	});
	const visits: Visits = new Map();
	if (request.start.kind === "saved") {
		for (const entry of run.active.filter(
			(active) => JSON.stringify(active.path) === JSON.stringify(path),
		)) {
			visits.set(entry.node, { meta: entry.meta, validation: { kind: "published", entry } });
		}
	}
	refreshVisits(visits, snapshot);
	for (const [index, step] of request.events.entries()) {
		try {
			snapshot = replayStep({ machine, definition, snapshot, visits, step });
		} catch (error) {
			throw stepFailure(error, index, step);
		}
	}
	const [actor] = retainedActors(machine, machine.getPersistedSnapshot(snapshot));
	return {
		formatVersion: FORMAT_VERSION,
		runId: id,
		actor: {
			...actor!.projection,
			id: request.actorId,
			path,
			instructions: renderNodeInstructions(
				machine.root,
				z.record(z.string(), z.unknown()).parse(snapshot.context),
				visitInstructions(visits),
			),
		},
		choices: availableChoices(definition, visits),
		inputSchema: z.toJSONSchema(definition.inputSchema, { io: "input" }),
	};
}

function visitInstructions(visits: Visits): WorkflowSimulation["actor"]["instructions"] {
	return Object.fromEntries(
		[...visits].map(([id, visit]) => {
			if (visit.validation.kind === "published") {
				return [id, publishedTaskInstruction(visit.validation.entry)];
			}
			return [id, renderedTaskInstruction(visit.meta)];
		}),
	);
}

// --- Private functions ---

function assertBaseline(
	request: WorkflowSimulationRequest,
	current: { checkpoint: string; savedAt: string; definition: { currentHash: string } },
): void {
	const expected = {
		checkpoint: request.checkpoint,
		savedAt: request.savedAt,
		definitionHash: request.definitionHash,
	};
	const actual = {
		checkpoint: current.checkpoint,
		savedAt: current.savedAt,
		definitionHash: current.definition.currentHash,
	};
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new BusyBeeError(
			"simulation_stale_baseline",
			"Saved workflow or definition changed; read a fresh preview",
			{
				context: { expected, current: actual },
			},
		);
	}
}

function startingSnapshot(input: {
	machine: AnyStateMachine;
	definition: Definition;
	start: WorkflowSimulationRequest["start"];
	saved: unknown;
	path: string[];
}): AnyMachineSnapshot {
	const { machine, definition, start, saved, path } = input;
	if (start.kind === "saved") {
		return savedSimulation(machine, saved);
	}
	if (path.length !== FIRST) {
		throw unsupportedSimulation("Initial input is supported only for the root actor");
	}
	return finalSimulation(initialSimulation(machine, definition.inputSchema.parse(start.input)));
}

// eslint-disable-next-line max-statements -- Validate a visit and update its virtual frontier together.
function replayStep(input: {
	machine: AnyStateMachine;
	definition: Definition;
	snapshot: AnyMachineSnapshot;
	visits: Visits;
	step: WorkflowSimulationRequest["events"][number];
}): AnyMachineSnapshot {
	const { machine, definition, snapshot, visits, step } = input;
	const visit = visits.get(step.node);
	const event = visit?.meta.commands?.[step.command];
	if (!visit || !event) {
		throw new BusyBeeError(
			"simulation_command_unavailable",
			`Command ${step.command} is unavailable on ${step.node}`,
		);
	}
	const data = payloadSchema(definition, step.command).parse(step.data);
	if (definition.validateCommand) {
		if (visit.validation.kind === "simulated") {
			throw unsupportedSimulation(
				"Author command validation requires a real published task identity",
			);
		}
		definition.validateCommand(structuredClone(visit.validation.entry), step.command, data);
	}
	const steps = advanceSimulation(machine, snapshot, { type: event, data });
	visits.delete(step.node);
	const settled = finalSimulation(steps);
	refreshVisits(visits, settled);
	return settled;
}

function refreshVisits(visits: Visits, snapshot: AnyMachineSnapshot): void {
	const nodes = workNodes(snapshot);
	for (const id of visits.keys()) {
		if (!nodes.some((node) => node.id === id)) {
			visits.delete(id);
		}
	}
	for (const node of nodes) {
		if (!visits.has(node.id)) {
			const context = structuredClone(snapshot.context) as Record<string, unknown>;
			visits.set(node.id, {
				meta: renderTask(metadataSchema.parse(node.meta), context),
				validation: { kind: "simulated" },
			});
		}
	}
}

function workNodes(snapshot: AnyMachineSnapshot): WorkflowNode[] {
	if (snapshot.status !== "active") {
		return [];
	}
	// XState's active hierarchy is also used by runtime.frontier; never emulate an ActorRef here.
	// eslint-disable-next-line no-underscore-dangle
	const nodes = snapshot._nodes;
	const completedParents = new Set(
		nodes.filter((node) => node.type === "final").map((node) => node.parent),
	);
	return nodes.filter(
		(node) => node.type !== "final" && node.meta?.["title"] && !completedParents.has(node),
	);
}

function availableChoices(definition: Definition, visits: Visits): WorkflowSimulation["choices"] {
	return [...visits].flatMap(([node, visit]) =>
		Object.entries(visit.meta.commands ?? {}).map(([command, event]) => ({
			node,
			title: visit.meta.title,
			command,
			event,
			schema: z.toJSONSchema(payloadSchema(definition, command), { io: "input" }),
		})),
	);
}

function payloadSchema(definition: Definition, command: string): z.ZodType {
	const schema = definition.commandSchemas[command];
	if (!schema) {
		throw new BusyBeeError("missing_command_schema", `Command ${command} has no payload schema`);
	}
	return schema;
}

function stepFailure(
	error: unknown,
	index: number,
	step: WorkflowSimulationRequest["events"][number],
): BusyBeeError {
	let reason = "simulation_invalid_event";
	if (error instanceof BusyBeeError) {
		({ reason } = error);
	} else if (error instanceof z.ZodError) {
		reason = "simulation_invalid_payload";
	}
	let detail = String(error);
	if (error instanceof Error) {
		detail = error.message;
	}
	return new BusyBeeError(
		reason,
		`Simulation step ${String(index)} failed (${step.node}, ${step.command}): ${detail}`,
		{
			cause: error,
			context: { step: index, node: step.node, command: step.command },
		},
	);
}
