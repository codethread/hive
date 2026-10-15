import type { AnyStateMachine, AnyTransitionDefinition } from "xstate";
import { BusyBeeError } from "./native.ts";
import type { WorkflowNode } from "./definition.ts";
import type { WorkflowPreview } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Compare structural state without accepting XState normalization.
import { isDeepStrictEqual } from "node:util";
import { workflowPreviewSchema } from "@hive/shared";
import { z } from "zod";

const FIRST = 0;
const snapshotSchema = workflowPreviewSchema.shape.actors.element.shape.snapshot;
const savedChildSchema = z.object({ src: z.string(), snapshot: z.unknown() });
const persistedActorSchema = snapshotSchema.extend({
	children: z.record(z.string(), savedChildSchema),
});

/** Project retained machine actors without creating actors or evaluating workflow callbacks. */
export function previewActors(machine: AnyStateMachine, saved: unknown): WorkflowPreview["actors"] {
	const actors: WorkflowPreview["actors"] = [];
	try {
		collectActors({ machine, saved, path: [] }, actors);
	} catch (error) {
		if (error instanceof BusyBeeError) {
			throw error;
		}
		throw new BusyBeeError(
			"preview_unavailable",
			"Cannot resolve the saved workflow actor tree against the current definition",
		);
	}
	return actors;
}

// --- Private functions ---

function collectActors(
	{ machine, saved, path }: { machine: AnyStateMachine; saved: unknown; path: string[] },
	actors: WorkflowPreview["actors"],
): void {
	const persisted = persistedActorSchema.parse(saved);
	const snapshot = machine.resolveState({ value: persisted.value, context: {} });
	if (!isDeepStrictEqual(snapshot.value, persisted.value)) {
		throw new BusyBeeError(
			"preview_unavailable",
			`Saved state at ${JSON.stringify(path)} is incomplete for the current machine`,
		);
	}
	actors.push({
		id: `actor:${JSON.stringify(path)}`,
		path,
		machine: structuralNode(machine.root),
		snapshot: snapshotSchema.parse(persisted),
	});
	for (const [childId, child] of Object.entries(persisted.children)) {
		const childLogic = childMachine(machine, child.src);
		collectActors({ machine: childLogic, saved: child.snapshot, path: [...path, childId] }, actors);
	}
}

// eslint-disable-next-line max-statements -- Keep the structural allowlist explicit in one traversal.
function structuralNode(node: WorkflowNode): Record<string, unknown> {
	const config: Record<string, unknown> = { id: node.id, type: node.type };
	if (node.type === "compound") {
		config["initial"] = node.initial.target[FIRST]!.key;
	}
	if (node.type === "history") {
		config["history"] = node.history;
		if (node.config.target !== undefined) {
			config["target"] = node.config.target;
		}
	}
	const states = Object.entries(node.states);
	if (states.length > FIRST) {
		config["states"] = Object.fromEntries(
			states.map(([key, child]) => [key, structuralNode(child)]),
		);
	}
	if (node.transitions.size > FIRST) {
		config["on"] = Object.fromEntries(
			[...node.transitions].map(([event, transitions]) => [
				event,
				transitions.map((transition) => structuralTransition(transition)),
			]),
		);
	}
	if (node.always) {
		config["always"] = node.always.map((transition) => structuralTransition(transition));
	}
	return config;
}

function structuralTransition(transition: AnyTransitionDefinition): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (transition.target) {
		result["target"] = transition.target.map((target) => `#${target.id}`);
	}
	if (transition.reenter) {
		result["reenter"] = true;
	}
	if (transition.guard !== undefined) {
		result["guard"] = guardLabel(transition.guard);
	}
	return result;
}

function guardLabel(guard: NonNullable<AnyTransitionDefinition["guard"]>): string {
	if (typeof guard === "string") {
		return guard;
	}
	if (typeof guard === "object") {
		return guard.type;
	}
	return "inline guard";
}

// XState 5 encodes inline invocation sources using the declaration index and node ID.
function childMachine(machine: AnyStateMachine, src: string): AnyStateMachine {
	const match = /^xstate\.invoke\.(?<index>\d+)\.(?<node>.*)$/u.exec(src);
	let logic: unknown = machine.implementations.actors[src];
	if (match) {
		const node = machine.getStateNodeById(match.groups!["node"]!);
		const declarations = [node.config.invoke].flat();
		logic = declarations[Number(match.groups!["index"])]?.src;
	}
	if (!logic || typeof logic !== "object" || !("root" in logic) || !("resolveState" in logic)) {
		throw new BusyBeeError(
			"preview_unavailable",
			`Saved child actor source ${src} has missing or unsupported machine logic`,
		);
	}
	return logic as AnyStateMachine;
}
