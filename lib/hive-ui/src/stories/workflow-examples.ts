/* eslint-disable eslint/no-restricted-imports -- Fixtures import pure example charts, never native Busy Bee code. */
/* eslint-disable import/max-dependencies -- The example catalogue imports four independent authored charts. */
import type { AnyMachineSnapshot, AnyStateMachine, UnknownAction } from "xstate";
import { HttpResponse, http } from "msw";
import type {
	WorkflowInspection,
	WorkflowSimulation,
	WorkflowSimulationRequest,
} from "../../contracts.ts";
import {
	commandSchemas as changeReviewCommands,
	inputSchema as changeReviewInput,
	machine as changeReviewMachine,
	validateCommand as changeReviewValidation,
} from "../../../busybee/examples/change-review/workflow.ts";
import { getMicrosteps, initialTransition } from "xstate";
import {
	commandSchemas as groceriesCommands,
	inputSchema as groceriesInput,
	machine as groceriesMachine,
} from "../../../busybee/examples/groceries/workflow.ts";
import {
	commandSchemas as linearCommands,
	inputSchema as linearInput,
	machine as linearMachine,
} from "../../../busybee/examples/bee-driver/linear.ts";
import {
	commandSchemas as parallelCommands,
	inputSchema as parallelInput,
	machine as parallelMachine,
} from "../../../busybee/examples/parallel/workflow.ts";

import { samplePreview, workflowSamples } from "./workflow-samples.ts";
import { workflowInspectionSchema, workflowSimulationRequestSchema } from "../../contracts.ts";
import { workflowHandlers } from "./workflow-simulation-fixture.ts";

import { z } from "zod";

const FIRST = 0;
const briefSchema = z.object({
	title: z.string().optional(),
	instructions: z.string(),
	commands: z.record(z.string(), z.string()).optional(),
});
interface Metadata {
	/** Default visit title before rendering the task brief. */
	title: string;
	/** Outcome commands mapped to XState event types. */
	commands?: Record<string, string> | undefined;
	/** Pure author callback that renders a brief from actor context. */
	task: (input: { context: Record<string, unknown> }) => unknown;
}
const metadataSchema = z.object({
	title: z.string(),
	commands: z.record(z.string(), z.string()).optional(),
	task: z.custom<Metadata["task"]>((value) => typeof value === "function"),
});
type WorkflowNode = AnyStateMachine["root"];
interface ExampleDefinition {
	/** Imported example chart used for local transitions. */
	machine: AnyStateMachine;
	/** Validates workflow input before simulation. */
	inputSchema: z.ZodType;
	/** Validates payloads by outcome command. */
	commandSchemas: Record<string, z.ZodType>;
	/** Optional author validation for visits in the saved fixture baseline. */
	validateCommand?:
		| ((
				entry: { bead: string; meta: Brief["meta"]; context: Record<string, unknown> },
				command: string,
				data: unknown,
		  ) => unknown)
		| undefined;
}
const LAST = -1;
interface Example {
	/** Imported chart and validation exports. */
	definition: ExampleDefinition;
	/** Fictional input used by the saved fixture. */
	input: unknown;
}
const examples: Record<"Parallel" | "Groceries" | "Change review" | "Linear", Example> = {
	Parallel: {
		definition: {
			machine: parallelMachine,
			inputSchema: parallelInput,
			commandSchemas: parallelCommands,
		},
		input: {},
	},
	Groceries: {
		definition: {
			machine: groceriesMachine,
			inputSchema: groceriesInput,
			commandSchemas: groceriesCommands,
		},
		input: {},
	},
	"Change review": {
		definition: {
			machine: changeReviewMachine,
			inputSchema: changeReviewInput,
			commandSchemas: changeReviewCommands,
			validateCommand: changeReviewValidation,
		},
		input: {
			base: "1234567890abcdef1234567890abcdef12345678",
			execution: { mode: "driver-handled" },
			request: "Review the example change",
			title: "Example change",
		},
	},
	Linear: {
		definition: {
			machine: linearMachine,
			inputSchema: linearInput,
			commandSchemas: linearCommands,
		},
		input: { worktree: "/example/hive", request: "Explore the workflow preview" },
	},
};
const exampleKeys = [
	"Parallel",
	"Groceries",
	"Change review",
	"Linear",
] satisfies (keyof typeof examples)[];
export type ExampleWorkflow = "Land" | keyof typeof examples;
export const exampleWorkflows: ExampleWorkflow[] = [
	"Land",
	"Parallel",
	"Groceries",
	"Change review",
	"Linear",
];
type Instructions = WorkflowSimulation["actor"]["instructions"];
interface Brief {
	/** Authored title, command mapping and rendered instructions for one visit. */
	meta: {
		/** Rendered title, falling back to the authored default. */
		title: string;
		/** Task instructions captured when this visit became active. */
		instructions: string;
		/** Outcome commands mapped to XState event types for this visit. */
		commands?: Record<string, string> | undefined;
	};
	/** Whether this visit belongs to the fixture's saved baseline. */
	published: boolean;
}
type Visits = Map<string, Brief>;

/** Captured Land state or an imported example chart, with fictional run data. */
export function exampleInspection(name: ExampleWorkflow): WorkflowInspection {
	if (name === "Land") {
		return samplePreview(workflowSamples[FIRST]!);
	}
	const { definition, input } = examples[name];
	const [snapshot] = initialTransition(definition.machine, input);
	const visits: Visits = new Map();
	refreshVisits(visits, snapshot, true);
	return {
		formatVersion: 1,
		runId: `example-${name}`,
		title: `Busy Bee example: ${name}`,
		checkpoint: `checkpoint-${name}`,
		savedAt: "2026-10-17T12:00:00Z",
		definition: { label: name, savedHash: "example", currentHash: "example", sourceMatch: "exact" },
		actors: [projectActor(definition.machine, snapshot, visits)],
	};
}

/** MSW responses computed from local example transitions. */
export function exampleHandlers() {
	return [
		http.post(
			"/api/colonies/:colony/workflow/example-:name/simulate",
			async ({ params, request }) => {
				try {
					const name = exampleKeys.find((value) => value === params["name"])!;
					return HttpResponse.json(simulateExample(name, await request.json()));
				} catch (error) {
					return HttpResponse.json(
						{ message: error instanceof Error ? error.message : String(error) },
						{ status: 400 },
					);
				}
			},
		),
		...workflowHandlers(),
	];
}

function simulateExample(name: keyof typeof examples, raw: unknown): WorkflowSimulation {
	const request = workflowSimulationRequestSchema.parse(raw);
	const { definition, input } = examples[name];
	const [initial] = initialTransition(
		definition.machine,
		definition.inputSchema.parse(request.start.kind === "initial" ? request.start.input : input),
	);
	let snapshot = initial;
	const visits: Visits = new Map();
	refreshVisits(visits, snapshot, request.start.kind === "saved");
	for (const step of request.events) {
		snapshot = advanceExample({ definition, snapshot, visits, step });
	}
	return {
		formatVersion: 1,
		runId: `example-${name}`,
		actor: projectActor(definition.machine, snapshot, visits),
		choices: [...visits].flatMap(([node, { meta }]) =>
			Object.entries(meta.commands ?? {}).map(([command, event]) => ({
				node,
				title: meta.title,
				command,
				event,
				schema: z.toJSONSchema(definition.commandSchemas[command]!, { io: "input" }),
			})),
		),
		inputSchema: z.toJSONSchema(definition.inputSchema, { io: "input" }),
	};
}

// eslint-disable-next-line max-statements -- Validate and advance one authored example outcome together.
function advanceExample({
	definition,
	snapshot,
	visits,
	step,
}: {
	definition: ExampleDefinition;
	snapshot: AnyMachineSnapshot;
	visits: Visits;
	step: WorkflowSimulationRequest["events"][number];
}): AnyMachineSnapshot {
	const visit = visits.get(step.node)!;
	const type = visit.meta.commands![step.command]!;
	const data: unknown = definition.commandSchemas[step.command]!.parse(step.data);
	if (definition.validateCommand) {
		if (!visit.published) {
			throw new Error("Author command validation requires a real published task identity");
		}
		definition.validateCommand(
			{ bead: "example-task", meta: visit.meta, context: snapshotContext(snapshot) },
			step.command,
			data,
		);
	}
	const event = { type, data };
	if (!snapshot.can(event)) {
		throw new Error(`Event ${type} is blocked in the simulated state`);
	}
	const microsteps = getMicrosteps(definition.machine, snapshot, event);
	if (
		microsteps.some(
			([state, actions]) =>
				Object.keys(z.record(z.string(), z.unknown()).parse(state.children)).length > FIRST ||
				actions.some((action) => !immediateRaise(action)),
		)
	) {
		throw new Error("Simulation requires actor coordination or unexecuted effects");
	}
	visits.delete(step.node);
	const settled = microsteps.at(LAST)![FIRST];
	refreshVisits(visits, settled, false);
	return settled;
}

function immediateRaise(action: UnknownAction): boolean {
	if (typeof action !== "object" || action.type !== "xstate.raise" || !("params" in action)) {
		return false;
	}
	const { params } = action;
	return (
		params !== null &&
		typeof params === "object" &&
		(!("delay" in params) || params.delay === undefined)
	);
}

function refreshVisits(visits: Visits, snapshot: AnyMachineSnapshot, published: boolean): void {
	// eslint-disable-next-line no-underscore-dangle -- XState exposes the active hierarchy here.
	const nodes = snapshot.status === "active" ? snapshot._nodes : [];
	const completed = new Set(
		nodes.filter((node) => node.type === "final").map((node) => node.parent),
	);
	const work = nodes.filter((node) => node.meta !== undefined && !completed.has(node));
	for (const id of visits.keys()) {
		if (!work.some((node) => node.id === id)) {
			visits.delete(id);
		}
	}
	for (const node of work) {
		if (!visits.has(node.id)) {
			visits.set(node.id, { meta: renderBrief(node, snapshotContext(snapshot)), published });
		}
	}
}

function projectActor(
	machine: AnyStateMachine,
	snapshot: AnyMachineSnapshot,
	visits: Visits,
): WorkflowInspection["actors"][number] {
	return {
		id: "actor:[]",
		path: [],
		machine: structure(machine.root),
		snapshot: workflowInspectionSchema.shape.actors.element.shape.snapshot.parse({
			value: z.unknown().parse(snapshot.value),
			status: snapshot.status,
		}),
		instructions: instructions(machine.root, snapshotContext(snapshot), visits),
	};
}

function instructions(
	node: WorkflowNode,
	context: Record<string, unknown>,
	visits: Visits,
): Instructions {
	let instruction: Instructions[string] = { kind: "none" };
	if (node.meta !== undefined) {
		try {
			const visit = visits.get(node.id);
			const { title, instructions: body } = visit?.meta ?? renderBrief(node, context);
			instruction =
				visit?.published === true
					? { kind: "frozen", title, instructions: body, bead: "example-task" }
					: { kind: "rendered", title, instructions: body };
		} catch (error) {
			instruction = {
				kind: "unavailable",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return Object.values(node.states).reduce<Instructions>(
		(result, child) => Object.assign(result, instructions(child, context, visits)),
		{ [node.id]: instruction },
	);
}

function renderBrief(node: WorkflowNode, context: Record<string, unknown>): Brief["meta"] {
	const meta = metadataSchema.parse(node.meta);
	const rendered = briefSchema.parse(meta.task({ context: structuredClone(context) }));
	return { ...meta, ...rendered, title: rendered.title ?? meta.title };
}

function structure(node: WorkflowNode): Record<string, unknown> {
	return {
		id: node.id,
		type: node.type,
		...(node.type === "compound" ? { initial: node.initial.target[FIRST]!.key } : {}),
		states: Object.fromEntries(
			Object.entries(node.states).map(([key, child]) => [key, structure(child)]),
		),
		on: Object.fromEntries(
			[...node.transitions].map(([event, transitions]) => [
				event,
				transitions.map((transition) => ({
					target: transition.target?.map((target) => `#${target.id}`),
					...(transition.guard === undefined
						? {}
						: { guard: typeof transition.guard === "string" ? transition.guard : "guard" }),
				})),
			]),
		),
		...(node.always === undefined
			? {}
			: {
					always: node.always.map((transition) => ({
						target: transition.target?.map((target) => `#${target.id}`),
					})),
				}),
	};
}

function snapshotContext(snapshot: AnyMachineSnapshot): Record<string, unknown> {
	return z.record(z.string(), z.unknown()).parse(snapshot.context);
}
