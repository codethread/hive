import type { AnyMachineSnapshot, AnyStateMachine, UnknownAction } from "xstate";
import { assign, createMachine, getInitialMicrosteps, getMicrosteps } from "xstate";
import { BusyBeeError } from "./native.ts";
import type { WorkflowNode } from "./definition.ts";
import { workflowPreviewSchema } from "@hive/shared";
import { z } from "zod";

const EMPTY = 0;
const LAST = 1;
const ACTIONS = 1;
const historyNodeSchema = z.array(z.object({ id: z.string() }));
const savedSchema = z.object({
	value: workflowPreviewSchema.shape.actors.element.shape.snapshot.shape.value,
	status: z.enum(["active", "done", "error", "stopped"]),
	context: z.record(z.string(), z.json()),
	historyValue: z.record(z.string(), historyNodeSchema).default({}),
	children: z.record(z.string(), z.unknown()),
});
type Assignment = Parameters<typeof assign>[typeof EMPTY];
type ActionImplementation = AnyStateMachine["implementations"]["actions"][string];
interface AssignBuiltin {
	/** XState's assign built-in carries its pure assignment separately from execution. */
	assignment: Assignment;
	/** Built-in action discriminator. */
	type: "xstate.assign";
}
type Microsteps = ReturnType<typeof getMicrosteps<AnyStateMachine>>;

/** Build an isolated chart with assignment actor access disabled, before any evaluation. */
export function simulationMachine(source: AnyStateMachine): AnyStateMachine {
	const implementations = {
		guards: source.implementations.guards,
		delays: source.implementations.delays,
		actions: Object.fromEntries(
			Object.entries(source.implementations.actions).map(([name, action]) => [
				name,
				preparedImplementation(action),
			]),
		),
	};
	const { context } = source.config;
	const config = { ...source.config };
	if (typeof context === "function") {
		config.context = (args: object) => context(isolatedArgs(args));
	}
	const machine = createMachine(config, implementations);
	prepareNode(machine.root);
	// Pure API scopes eagerly initialize without input; structural seeding avoids extra author callbacks.
	machine.getInitialSnapshot = () => machine.resolveState({ value: {}, context: {} });
	return machine;
}

/** Resolve serialized history references without restoring/starting child actors. */
export function savedSimulation(machine: AnyStateMachine, raw: unknown): AnyMachineSnapshot {
	const saved = savedSchema.parse(raw);
	if (Object.keys(saved.children).length !== EMPTY || hasActorReference(saved.context)) {
		throw unsupportedSimulation(
			"Saved actor children or actor references require live coordination",
		);
	}
	const snapshot = machine.resolveState({
		...saved,
		context: structuredClone(saved.context),
		historyValue: Object.fromEntries(
			Object.entries(saved.historyValue).map(([id, nodes]) => [
				id,
				nodes.map((node) => machine.getStateNodeById(node.id)),
			]),
		),
	});
	snapshot.status = saved.status;
	assertIsolatedState(snapshot);
	return snapshot;
}

/** Evaluate initial entry and eventless transitions, retaining every intermediate snapshot. */
export function initialSimulation(machine: AnyStateMachine, input: unknown): Microsteps {
	return checkedSteps(getInitialMicrosteps(machine, input));
}

/** Evaluate a validated event using XState's pure macrostep implementation. */
export function advanceSimulation(
	machine: AnyStateMachine,
	snapshot: AnyMachineSnapshot,
	event: { type: string; data: unknown },
): Microsteps {
	if (snapshot.status !== "active" || !snapshot.can(event)) {
		throw new BusyBeeError(
			"simulation_event_blocked",
			`Event ${event.type} is blocked in the simulated state`,
		);
	}
	return checkedSteps(getMicrosteps(machine, snapshot, event));
}

export function finalSimulation(steps: Microsteps): AnyMachineSnapshot {
	return steps[steps.length - LAST]![EMPTY];
}

export function unsupportedSimulation(message: string): BusyBeeError {
	return new BusyBeeError("simulation_unsupported", message);
}

// --- Private functions ---

function prepareNode(node: WorkflowNode): void {
	node.entry = node.entry.map((action) => isolatedAction(node, action));
	if (node.config.invoke !== undefined || node.config.after !== undefined) {
		node.entry.unshift(
			assign(() => {
				throw unsupportedSimulation(`Actor invocation and timers are unsupported (${node.id})`);
			}),
		);
	}
	node.exit = node.exit.map((action) => isolatedAction(node, action));
	const transitions = [
		...[...node.transitions.values()].flat(),
		...(node.always ?? []),
		node.initial,
	];
	for (const transition of transitions) {
		transition.actions = transition.actions.map((action) => isolatedAction(node, action));
	}
	Object.values(node.states).forEach((child) => prepareNode(child));
}

function isolatedAction(node: WorkflowNode, action: UnknownAction): UnknownAction {
	const resolved = resolveAction(node, action);
	if (isAssign(resolved)) {
		if (typeof action === "function") {
			return isolatedAssign(resolved);
		}
		return action;
	}
	if (typeof resolved === "function" && "type" in resolved && resolved.type === "xstate.raise") {
		return action;
	}
	return assign(() => {
		throw unsupportedSimulation("Simulation requires actor coordination or unexecuted effects");
	});
}

function resolveAction(node: WorkflowNode, action: UnknownAction): unknown {
	if (typeof action === "function") {
		return action;
	}
	if (typeof action === "string") {
		return node.machine.implementations.actions[action];
	}
	return node.machine.implementations.actions[action.type];
}

function preparedImplementation(action: ActionImplementation): ActionImplementation {
	if (isAssign(action)) {
		return isolatedAssign(action);
	}
	return action;
}

function isAssign(action: unknown): action is AssignBuiltin {
	return typeof action === "function" && "type" in action && action.type === "xstate.assign";
}

function isolatedAssign(action: AssignBuiltin): ReturnType<typeof assign> {
	const { assignment } = action;
	return assign((args, params) => {
		const isolated = isolatedArgs(args);
		if (typeof assignment === "function") {
			return assignment(isolated, params);
		}
		return Object.fromEntries(
			Object.entries(assignment).map(([key, value]) => {
				if (typeof value === "function") {
					return [key, value(isolated, params)];
				}
				return [key, value];
			}),
		);
	});
}

function isolatedArgs<Args extends object>(args: Args): Args {
	return new Proxy(args, {
		get(target, key, receiver) {
			if (key === "spawn" || key === "self" || key === "system") {
				throw unsupportedSimulation(
					`Actor access through ${String(key)} is unsupported in simulation`,
				);
			}
			return Reflect.get(target, key, receiver) as unknown;
		},
	});
}

function checkedSteps(steps: Microsteps): Microsteps {
	for (const [snapshot, actions] of steps) {
		if (snapshot.status === "error") {
			throw snapshot.error;
		}
		assertIsolatedState(snapshot);
		if (actions.some((action) => !immediateRaise(action))) {
			throw unsupportedSimulation("Simulation requires actor coordination or unexecuted effects");
		}
	}
	return steps;
}

function assertIsolatedState(snapshot: AnyMachineSnapshot): void {
	// eslint-disable-next-line no-underscore-dangle -- Inspect the active XState hierarchy, as in frontier projection.
	const nodes = snapshot._nodes;
	const coordinated =
		snapshot.status === "active" &&
		nodes.some((node) => node.config.invoke !== undefined || node.config.after !== undefined);
	if (
		coordinated ||
		Object.keys(snapshot.children).length !== EMPTY ||
		hasActorReference(snapshot.context)
	) {
		throw unsupportedSimulation(
			"Active invocation, timers or actor references require live coordination",
		);
	}
}

function immediateRaise(action: Microsteps[number][typeof ACTIONS][number]): boolean {
	const { params } = action;
	return (
		action.type === "xstate.raise" &&
		params !== null &&
		typeof params === "object" &&
		(!("delay" in params) || params.delay === undefined)
	);
}

function hasActorReference(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	return "xstate$$type" in value || Object.values(value).some((child) => hasActorReference(child));
}
