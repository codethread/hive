import { createMachine, initialTransition, transition } from "xstate";
import type { AnyStateMachine } from "xstate";
import type { WorkflowInspection } from "../../contracts.ts";
import { exampleInspection } from "./workflow-examples.ts";
import { workflowInspectionSchema } from "../../contracts.ts";

const remainingSteps = { verification: 3, documentation: 4, interface: 5, migration: 5 };
const stressMachine = createMachine({
	id: "hierarchy-stress",
	initial: "prepare",
	states: {
		prepare: { on: { NEXT: "implementation" } },
		implementation: {
			type: "parallel",
			onDone: "handoff",
			states: {
				api: {
					initial: "design",
					states: {
						design: { on: { "API.NEXT": "implement" } },
						implement: { on: { "API.NEXT": "verification" } },
						verification: {
							type: "parallel",
							onDone: "package",
							states: {
								unit: branch("UNIT", ["prepare", "execute", "inspect"]),
								contract: branch("CONTRACT", ["describe", "execute", "inspect"]),
								security: branch("SECURITY", ["scan", "remediate", "verify"]),
							},
						},
						package: { on: { "API.NEXT": "done" } },
						done: { type: "final" },
					},
				},
				docs: branch("DOCS", ["outline", "write", "examples", "links", "accessibility", "review"]),
				interface: branch("UI", [
					"research",
					"design",
					"implement",
					"responsive",
					"keyboard",
					"review",
				]),
				migration: branch("MIGRATION", [
					"inventory",
					"plan",
					"implement",
					"backfill",
					"verify",
					"review",
				]),
			},
		},
		handoff: { on: { NEXT: "done" } },
		done: { type: "final" },
	},
});

export type HierarchyPosition = "mixed" | "api-done" | "handoff";

/** Fictional snapshots for the production canvas stress story. */
export function hierarchyInspection(position: HierarchyPosition = "mixed"): WorkflowInspection {
	let [snapshot] = initialTransition(stressMachine);
	const events = [
		"NEXT",
		"API.NEXT",
		"API.NEXT",
		"DOCS.NEXT",
		"DOCS.NEXT",
		"UI.NEXT",
		"MIGRATION.NEXT",
	];
	if (position !== "mixed") {
		events.push(
			...Array.from({ length: remainingSteps.verification }, () => "UNIT.NEXT"),
			...Array.from({ length: remainingSteps.verification }, () => "CONTRACT.NEXT"),
			...Array.from({ length: remainingSteps.verification }, () => "SECURITY.NEXT"),
			"API.NEXT",
		);
	}
	if (position === "handoff") {
		events.push(
			...Array.from({ length: remainingSteps.documentation }, () => "DOCS.NEXT"),
			...Array.from({ length: remainingSteps.interface }, () => "UI.NEXT"),
			...Array.from({ length: remainingSteps.migration }, () => "MIGRATION.NEXT"),
		);
	}
	for (const type of events) {
		[snapshot] = transition(stressMachine, snapshot, { type });
	}
	const nodes = stateNodes(stressMachine.root);
	return workflowInspectionSchema.parse({
		...exampleInspection("Parallel"),
		runId: "example/hierarchy-stress",
		title: "Hierarchy stress",
		definition: {
			label: "Fictional hierarchy stress chart",
			savedHash: "example-stress",
			currentHash: "example-stress",
			sourceMatch: "exact",
		},
		actors: [
			{
				id: "root",
				path: [],
				machine: stressMachine.config,
				snapshot,
				instructions: Object.fromEntries(nodes.map((node) => [node.id, { kind: "none" }])),
			},
		],
	});
}

function branch(prefix: string, steps: string[]): Parameters<typeof createMachine>[0] {
	return {
		initial: steps[0]!,
		states: {
			...Object.fromEntries(
				steps.map((step, index) => [
					step,
					{
						on: { [`${prefix}.NEXT`]: steps[index + 1] ?? "done" },
					},
				]),
			),
			done: { type: "final" },
		},
	};
}

function stateNodes(node: AnyStateMachine["root"]): AnyStateMachine["root"][] {
	return [node, ...Object.values(node.states).flatMap((child) => stateNodes(child))];
}
