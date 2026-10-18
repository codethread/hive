import type { WorkflowInspection } from "../contracts.ts";
import { createMachine } from "xstate";

const LAST = -1;

// Consume only XState's structural fields; implementation/meta generics stay outside the view model.
interface GraphStateNode {
	id: string;
	path: string[];
	type: string;
	states: Record<string, GraphStateNode>;
	initial: { target: readonly GraphStateNode[] };
	transitions: ReadonlyMap<string, readonly GraphTransition[]>;
	always?: readonly GraphTransition[] | undefined;
	invoke: readonly { id: string }[];
}

interface GraphTransition {
	eventType: string;
	target?: readonly GraphStateNode[] | undefined;
	guard?: string | { type: string } | ((...parameters: never[]) => unknown) | undefined;
}

export interface WorkflowGraph {
	/** Steps keyed by complete state-node IDs, including authored custom IDs. */
	steps: Record<string, WorkflowGraphStep>;
	/** Distinct authored transitions, including parallel edges and automatic routes. */
	transitions: Record<string, WorkflowGraphTransition[]>;
	/** Initial children of compound states. */
	initial: string[];
}

export interface WorkflowGraphStep {
	/** Full readable state path used by inspection and selection. */
	title: string;
	/** Authored state type, with task and automatic presentation kinds. */
	kind: string;
	/** Authored dispatch kind, independent of workflow position. */
	bee?: string;
	/** Containing visible state, or null at the displayed machine boundary. */
	parent: string | null;
	/** Ordered direct children from the same machine, never invoked actors. */
	children: string[];
	/** Retained child machines belonging to this state's authored invocations. */
	workflows?: string[];
}

export interface WorkflowGraphTransition {
	/** Stable identity of one transition target. */
	id: string;
	/** Original event identifier; empty for eventless routes. */
	event: string;
	/** Event and descriptive guard label. */
	label: string;
	/** Full target state-node ID. */
	target: string;
}

/** Compile only the producer's structural projection; no actors, events or guards run. */
// eslint-disable-next-line max-statements -- Project structure, dispatch kinds and active state together.
export function workflowActorGraph(
	actor: WorkflowInspection["actors"][number],
	actors: WorkflowInspection["actors"] = [],
) {
	const machine = createMachine(actor.machine);
	void machine.definition;
	const allNodes = stateNodes(machine.root);
	const rootUsed =
		machine.root.type === "parallel" ||
		machine.root.invoke.length > 0 ||
		actor.instructions[machine.root.id]!.kind !== "none" ||
		allNodes.length === 1 ||
		allNodes.some((node) =>
			[...[...node.transitions.values()].flat(), ...(node.always ?? [])].some(
				(transition) =>
					node === machine.root || (transition.target?.includes(machine.root) ?? false),
			),
		);
	const nodes = allNodes.filter((node) => node !== machine.root || rootUsed);
	const graph = projectGraph(nodes, machine.root);
	for (const node of nodes) {
		const workflows = node.invoke.flatMap((invocation) =>
			actors
				.filter(
					(child) => JSON.stringify(child.path) === JSON.stringify([...actor.path, invocation.id]),
				)
				.map((child) => child.id),
		);
		if (workflows.length > 0) {
			graph.steps[node.id]!.workflows = workflows;
		}
	}
	for (const [id, instruction] of Object.entries(actor.instructions)) {
		if ((instruction.kind === "frozen" || instruction.kind === "rendered") && instruction.bee) {
			graph.steps[id]!.bee = instruction.bee.kind;
		}
	}
	const snapshot = machine.resolveState({ value: actor.snapshot.value, context: {} });
	// eslint-disable-next-line no-underscore-dangle -- XState exposes the resolved active state nodes here.
	const current = snapshot._nodes
		.filter((node) => node !== machine.root || rootUsed)
		.map((node) => node.id);
	return { graph, current };
}

export function workflowActorTitle(actor: WorkflowInspection["actors"][number]): string {
	return stateTitle(actor.path.at(LAST) ?? "Workflow");
}

/** Visible state projection; hidden endpoints never become synthetic transitions. */
export function workflowScope(
	graph: WorkflowGraph,
	focus: string | null,
	collapsed: ReadonlySet<string>,
): WorkflowGraph {
	if (focus === null && collapsed.size === 0) {
		return graph;
	}
	const visible = (id: string): string[] => [
		id,
		...(collapsed.has(id) ? [] : graph.steps[id]!.children.flatMap(visible)),
	];
	const roots =
		focus === null
			? Object.keys(graph.steps).filter((id) => graph.steps[id]!.parent === null)
			: [focus];
	const ids = roots.flatMap((id) => visible(id));
	return {
		steps: Object.fromEntries(
			ids.map((id) => [
				id,
				{
					...graph.steps[id]!,
					parent: roots.includes(id) ? null : graph.steps[id]!.parent,
					children: graph.steps[id]!.children.filter((child) => ids.includes(child)),
				},
			]),
		),
		transitions: Object.fromEntries(
			ids.map((id) => [id, graph.transitions[id]!.filter((edge) => ids.includes(edge.target))]),
		),
		initial: graph.initial.filter((id) => ids.includes(id)),
	};
}

/** Ancestor IDs in breadcrumb order, ending at the requested state. */
export function workflowScopePath(graph: WorkflowGraph, id: string): string[] {
	const { parent } = graph.steps[id]!;
	return [...(parent === null ? [] : workflowScopePath(graph, parent)), id];
}

/** Current paths and local completion, without claiming historical visits or worker outcomes. */
export function workflowScopeSummary(graph: WorkflowGraph, id: string, current: string[]): string {
	if (!current.includes(id)) {
		return "Not current";
	}
	if (scopeDone(graph, id, current)) {
		return "Scope done";
	}
	const leaves = Object.entries(graph.steps).filter(
		([child, step]) =>
			current.includes(child) &&
			step.children.length === 0 &&
			workflowScopePath(graph, child).includes(id),
	);
	const prefix = `${graph.steps[id]!.title} / `;
	return leaves
		.map(([, step]) =>
			step.title.startsWith(prefix) ? step.title.slice(prefix.length) : step.title,
		)
		.join(" · ");
}

function scopeDone(graph: WorkflowGraph, id: string, current: string[]): boolean {
	const step = graph.steps[id]!;
	if (!current.includes(id)) {
		return false;
	}
	if (step.kind === "final") {
		return true;
	}
	return step.kind === "parallel"
		? step.children
				.filter((child) => graph.steps[child]!.kind !== "history")
				.every((child) => scopeDone(graph, child, current))
		: step.children.some(
				(child) => current.includes(child) && graph.steps[child]!.kind === "final",
			);
}

function projectGraph(nodes: GraphStateNode[], root: GraphStateNode): WorkflowGraph {
	const graph: WorkflowGraph = { steps: {}, transitions: {}, initial: [] };
	for (const node of nodes) {
		graph.steps[node.id] = {
			title: stateTitle(node.path.length === 0 ? root.id : node.path.join(" / ")),
			kind:
				node.type === "atomic" && (node.always?.length ?? 0) > 0
					? "automatic"
					: node.type.replace("atomic", "task"),
			parent: nodes.find((candidate) => Object.values(candidate.states).includes(node))?.id ?? null,
			children: orderedChildren(node).map((child) => child.id),
		};
		const definitions = [...[...node.transitions.values()].flat(), ...(node.always ?? [])];
		graph.transitions[node.id] = definitions.flatMap((transition, index) => {
			const event = transition.eventType;
			const label = event || "always";
			return (transition.target ?? [node]).map((target, targetIndex) => ({
				id: `${node.id}:${event}:${index}:${targetIndex}`,
				event,
				label:
					transition.guard === undefined ? label : `${label} [${guardLabel(transition.guard)}]`,
				target: target.id,
			}));
		});
		graph.initial.push(...node.initial.target.map((target) => target.id));
	}
	graph.initial.push(...root.initial.target.map((target) => target.id));
	return graph;
}

function stateNodes(node: GraphStateNode): GraphStateNode[] {
	return [node, ...orderedChildren(node).flatMap((child) => stateNodes(child))];
}

function orderedChildren(node: GraphStateNode): GraphStateNode[] {
	if (node.type === "parallel") {
		return Object.values(node.states);
	}
	const children = Object.values(node.states);
	const ordered: GraphStateNode[] = [];
	const visit = (child: GraphStateNode) => {
		if (ordered.includes(child)) {
			return;
		}
		ordered.push(child);
		for (const transition of [...[...child.transitions.values()].flat(), ...(child.always ?? [])]) {
			for (const target of transition.target ?? []) {
				if (children.includes(target)) {
					visit(target);
				}
			}
		}
	};
	for (const child of [...node.initial.target, ...children]) {
		visit(child);
	}
	return ordered;
}

function stateTitle(path: string) {
	return path
		.split(" / ")
		.map((part) =>
			part === "pr" ? "PR" : part.charAt(0).toUpperCase() + part.slice(1).replaceAll("-", " "),
		)
		.join(" / ");
}

function guardLabel(guard: NonNullable<GraphTransition["guard"]>) {
	if (typeof guard === "string") {
		return guard;
	}
	if (typeof guard === "object") {
		return guard.type;
	}
	return "inline guard";
}
