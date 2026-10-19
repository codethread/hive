/* eslint-disable typescript/no-unsafe-type-assertion --
 * Compiled XState nodes erase concrete keys and metadata;
 * this adapter reads only the trusted repo-owned Land definition.
 */
import type { EventFrom, SnapshotFrom } from "xstate";
import {
	commandSchemas,
	inputSchema,
	machine,
	runBrief,
} from "../../../../.workflows/land/workflow.ts";
import { getMicrosteps, initialTransition } from "xstate";
import type { WorkflowGraph } from "../workflow-graph.ts";

const LAST_ENTRY = -1;

export type LandSnapshot = SnapshotFrom<typeof machine>;
export type StepId = Extract<LandSnapshot["value"], string>;
type LandEvent = EventFrom<typeof machine>;
type Command = keyof typeof commandSchemas;

export interface SampleContext {
	/** Example authorization rendered in Land's run brief. */
	request: string;
	/** Worktree branch used when the example target is a worktree. */
	branch: string;
	/** Target kind rendered by the Land workflow. */
	target: "worktree" | "pr";
	/** Example PR target; never contacted by this story. */
	prUrl: string;
	/** Fictional evidence supplied in each simulated outcome payload. */
	evidence: string;
}

export interface SampleTransition {
	/** Stable identity of one authored transition, including parallel edges. */
	id: string;
	/** Event identifier; an empty string represents an eventless transition. */
	event: string;
	/** Event and guard shown on the graph edge. */
	label: string;
	/** Destination from the actual compiled definition. */
	target: StepId;
	/** Named guard, or null for an unconditional transition. */
	guard: string | null;
}

export interface LandVisit {
	/** Snapshot with simulated context updates and fictional evidence. */
	snapshot: LandSnapshot;
	/** States entered by this outcome, including automatic routing states. */
	path: StepId[];
}

type LandStep =
	| { title: string; kind: "task"; metadata: LandMetadata; bee?: string }
	| { title: string; kind: "automatic" | "final" };

interface LandMetadata {
	/** Authored worker title. */
	title: string;
	/** Authored command names and their corresponding XState events. */
	commands: Record<Command, LandEvent["type"]>;
	/** Pure author callback; its output is displayed without executing instructions. */
	task: (input: { context: LandSnapshot["context"] }) => {
		title: string;
		instructions: string;
		bee?: { kind: string };
	};
}

export const sampleContext: SampleContext = {
	request: "Example: finish and land the workflow instruction panel",
	branch: "example/workflow-preview",
	target: "pr",
	prUrl: "https://github.com/example/hive/pull/42",
	evidence:
		"Fictional evidence for this walkthrough; no review, checks or integration were performed.",
};
export const exampleStep: StepId = "check";

// Compile lazy XState node definitions before reading their transition maps.
void machine.definition;
export const initialStep = machine.root.initial.target[0]!.key as StepId;
export const stepIds = Object.keys(machine.states) as StepId[];
export const steps = Object.fromEntries(
	stepIds.map((id) => {
		const node = machine.states[id]!;
		const title = id.charAt(0).toUpperCase() + id.slice(1).replaceAll("-", " ");
		if (node.type === "final") {
			return [id, { title, kind: "final" }];
		}
		if ((node.always?.length ?? 0) > 0) {
			return [id, { title, kind: "automatic" }];
		}
		const metadata = node.meta as LandMetadata;
		const { context } = exampleVisit(sampleContext, "example").snapshot;
		return [id, { title, kind: "task", metadata, bee: metadata.task({ context }).bee?.kind }];
	}),
) as Record<StepId, LandStep>;

export const transitions = Object.fromEntries(
	stepIds.map((id) => {
		const node = machine.states[id]!;
		const definitions = [...[...node.transitions.values()].flat(), ...(node.always ?? [])];
		return [
			id,
			definitions.map((definition, index): SampleTransition => {
				const guard = definition.guard as string | undefined;
				const event = definition.eventType;
				const label = event || "always";
				return {
					id: `${id}:${event}:${index}`,
					event,
					label: guard === undefined ? label : `${label} [${guard}]`,
					target: definition.target![0]!.key as StepId,
					guard: guard ?? null,
				};
			}),
		];
	}),
) as Record<StepId, SampleTransition[]>;

export const transitionCount = Object.values(transitions).flat().length;
export const landGraph: WorkflowGraph = {
	steps: Object.fromEntries(
		stepIds.map((id) => [id, { ...steps[id], parent: null, children: [] }]),
	),
	transitions,
	initial: [initialStep],
};

export function exampleVisit(sample: SampleContext, start: "initial" | "example"): LandVisit {
	const input = inputSchema.parse({
		request: sample.request,
		target:
			sample.target === "pr"
				? { kind: "pr", url: sample.prUrl }
				: { kind: "worktree", branch: sample.branch },
		canonicalRoot: "/example/hive",
		beadsDb: "/example/hive/.worktrees/tracker--state/.beads/beads.db",
		completedTasks: [],
	});
	const [initial] = initialTransition(machine, input);
	const snapshot = machine.resolveState({
		value: start === "initial" ? initial.value : exampleStep,
		context: { ...initial.context, evidence: sample.evidence },
	});
	return { snapshot, path: [snapshot.value] };
}

export function renderInstructions(step: StepId, context: LandSnapshot["context"]) {
	const details = steps[step];
	if (details.kind === "task") {
		return {
			...details.metadata.task({ context }),
			source: "Land task instructions · fictional context",
		};
	}
	if (details.kind === "automatic") {
		return {
			title: "Automatic routing",
			instructions:
				`This state has no worker instructions. ` +
				`The workflow immediately follows the first matching route.\n\n${transitions[step]
					.map((edge) => `- ${edge.guard ?? "Otherwise"} → **${steps[edge.target].title}**`)
					.join("\n")}`,
			source: "Land automatic routing · fictional context",
		};
	}
	return {
		title: "Final state: Done",
		instructions:
			`This final state has no worker instructions. ` +
			`The run brief includes the caller's responsibilities after a real run reports done:\n\n${
				runBrief(context).description
			}`,
		source: "Land run brief · fictional context",
	};
}

export function availableOutcomes(snapshot: LandSnapshot, sample: SampleContext) {
	const step = steps[snapshot.value];
	if (step.kind !== "task") {
		return [];
	}
	const { metadata } = step;
	return Object.entries(metadata.commands).map(([command, type]) => {
		const data = commandSchemas[command as Command].parse({
			evidence: sample.evidence,
		});
		const event: LandEvent = { type, data };
		const enabled = snapshot.can(event);
		return {
			command,
			event,
			target: transitions[snapshot.value].find((edge) => edge.event === type)!.target,
			enabled,
		};
	});
}

export function advance(snapshot: LandSnapshot, event: LandEvent): LandVisit {
	const microsteps = getMicrosteps(machine, snapshot, event);
	return {
		snapshot: microsteps.at(LAST_ENTRY)![0],
		path: microsteps.map(([state]) => state.value),
	};
}
