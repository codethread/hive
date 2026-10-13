import type { ActorRefFrom, AnyStateMachine, Snapshot } from "xstate";
import { BusyBeeError, createServices } from "./native.ts";
import { createActor, initialTransition } from "xstate";
import type { Services } from "./native.ts";
import type { Source } from "./catalogue.ts";
import { fingerprint } from "./catalogue.ts";
import { z } from "zod";

const NONEMPTY = 1;
const LAST_SEGMENT = 1;
const text = z.string().min(NONEMPTY);
const beeKindSchema = z.object({ kind: text }).nullable().optional();
const commandsSchema = z.record(z.string(), text);
const commandSchemasSchema = z.record(z.string(), z.instanceof(z.ZodType));
const contextSchema = z.compile(z.record(z.string(), z.unknown()));
export const briefSchema = z.compile(z.object({ description: z.string(), title: text }));
export const resolvedTaskSchema = z.compile(
	z.object({
		bee: beeKindSchema,
		commands: commandsSchema.optional(),
		instructions: z.string(),
		title: text,
	}),
);
export type ResolvedTask = z.infer<typeof resolvedTaskSchema>;
export interface TaskContext<Context = Record<string, unknown>> {
	/** Context when this published task visit enters. */
	context: Context;
}
export interface TaskEntry extends TaskContext {
	/** Active native worker/group bead. */
	bead: string;
	/** Frozen instructions and command mapping. */
	meta: ResolvedTask;
}
export interface Metadata {
	/** Titled states project into native beads. */
	title: string;
	/** Named commands mapped to events. */
	commands?: Record<string, string> | undefined;
	/** Optional Bee execution kind. */
	bee?: { kind: string } | null | undefined;
	/** Render instructions and optional metadata overrides once per published task visit. */
	task: (input: TaskContext) => unknown;
}
export const metadataSchema = z.compile(
	resolvedTaskSchema.omit({ instructions: true }).extend({
		task: z.custom<Metadata["task"]>(callable),
	}),
);
// Public ActorLogic is structural across independent CLI and repository XState installations.
const machineContract = z.compile(
	z.object({
		getInitialSnapshot: z.custom(callable),
		getPersistedSnapshot: z.custom(callable),
		restoreSnapshot: z.custom(callable),
		transition: z.custom(callable),
	}),
);
const definitionSchema = z.compile(
	z.object({
		commandSchemas: commandSchemasSchema,
		describe: z.custom<(entry: TaskEntry) => Record<string, unknown>>(callable).optional(),
		inputConstraints: z.string().optional(),
		inputSchema: z.instanceof(z.ZodType),
		/** Preflight checks raw persisted root context without migrating or replacing it. */
		resumeSchema: z.instanceof(z.ZodType).optional(),
		machine: z.custom<AnyStateMachine>(machineLike),
		runBrief: z.custom<(input: unknown) => unknown>(callable),
		validateCommand: z
			.custom<(entry: TaskEntry, command: string, data: unknown) => void>(callable)
			.optional(),
	}),
);
export type Definition = z.infer<typeof definitionSchema>;
/** Dynamic author machines cross one typed seam; app-owned fields remain schema checked. */
export type WorkflowActor = ActorRefFrom<AnyStateMachine>;
export type WorkflowNode = AnyStateMachine["root"];
export async function load(
	source: Source & { expectedHash?: string },
	services: Services = createServices(),
): Promise<{ definition: Definition; hash: string }> {
	const hash = await fingerprint(source, services);
	if (source.expectedHash && source.expectedHash !== hash) {
		throw new BusyBeeError(
			"definition_changed",
			`Workflow definition changed; inspect the current source at ${source.source} and start a fresh run.`,
		);
	}
	return { definition: await importDefinition(source.source, services), hash };
}

/** Import and validate a definition without calculating unused provenance. */
export async function importDefinition(source: string, services: Services): Promise<Definition> {
	return definitionSchema.parse(await services.importModule(source));
}

export async function readInput(
	definition: Definition,
	inputFile: string | undefined,
	services: Services,
): Promise<unknown> {
	let input: unknown = {};
	if (inputFile) {
		input = JSON.parse(await services.readText(inputFile)) as unknown;
	}
	return definition.inputSchema.parse(input);
}

/** Resolve author overrides using the context selected and owned by the caller. */
export function renderTask(metadata: Metadata, context: Record<string, unknown>): ResolvedTask {
	const { task, ...defaults } = metadata;
	return resolvedTaskSchema.parse({ ...defaults, ...contextSchema.parse(task({ context })) });
}

export async function validate(
	source: string,
	inputFile: string | undefined,
	services: Services,
): Promise<{ checks: string[]; source: string; status: string }> {
	const definition = await importDefinition(source, services);
	const input = await readInput(definition, inputFile, services);
	// Resolve lazy XState node definitions before evaluating the initial pure transition.
	void definition.machine.definition;
	const [snapshot] = initialTransition(definition.machine, input);
	if (snapshot.status === "error") {
		throw snapshot.error;
	}
	return {
		checks: ["definition_resolution", "input_schema", "initial_snapshot"],
		source,
		status: snapshot.status,
	};
}

export function actorFor(
	definition: Definition,
	state: { input: unknown } | { snapshot: Snapshot<unknown> },
): WorkflowActor {
	const actor = createActor(definition.machine, state);
	// Snapshot checks report failures through the CLI.
	// Observe errors to suppress XState's asynchronous unhandled-error channel.
	actor.subscribe({ error: () => {} });
	return actor;
}

export function actorContext(actor: WorkflowActor): Record<string, unknown> {
	return contextSchema.parse(actor.getSnapshot().context as unknown);
}

export function childActors(actor: WorkflowActor): WorkflowActor[] {
	// Busy Bee definitions spawn machine actors. XState's generic children also admits promise actors.
	return Object.values(actor.getSnapshot().children).filter(
		(child) => child !== undefined,
	) as WorkflowActor[];
}

/** Check XState event descriptors without evaluating guards or advancing an actor. */
export function declaresEvent(node: WorkflowNode, event: string): boolean {
	let current: WorkflowNode | undefined = node;
	while (current) {
		if (
			[...current.transitions.keys()].some((descriptor) =>
				matchesEventDescriptor(event, descriptor),
			)
		) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

export function targetActor(root: WorkflowActor, path: string[]): WorkflowActor {
	return path.reduce((actor, id) => childActors(actor).find((child) => child.id === id)!, root);
}

export function initialActor(definition: Definition, input: unknown): WorkflowActor {
	const actor = actorFor(definition, { input });
	actor.start();
	const snapshot = actor.getSnapshot();
	if (snapshot.status === "error") {
		actor.stop();
		throw snapshot.error;
	}
	return actor;
}

/** Start an actor from a persisted workflow snapshot. */
export function restoredActor(definition: Definition, snapshot: Snapshot<unknown>): WorkflowActor {
	const actor = actorFor(definition, { snapshot });
	actor.start();
	return actor;
}

export function currentStatus(actor: WorkflowActor): string {
	return actor.getSnapshot().status;
}

export function snapshotFor(actor: WorkflowActor): Snapshot<unknown> {
	return actor.getPersistedSnapshot();
}

function callable(value: unknown): value is (...args: unknown[]) => unknown {
	return typeof value === "function";
}

function machineLike(value: unknown): value is AnyStateMachine {
	return machineContract.safeParse(value).success;
}

function matchesEventDescriptor(event: string, descriptor: string): boolean {
	if (descriptor === event || descriptor === "*") {
		return true;
	}
	if (!descriptor.endsWith(".*")) {
		return false;
	}
	const segments = descriptor.split(".");
	const tokens = event.split(".");
	return segments.every((segment, index) => {
		if (segment === "*") {
			return index === segments.length - LAST_SEGMENT;
		}
		return segment === tokens[index];
	});
}
