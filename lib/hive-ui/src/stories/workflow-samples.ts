import type { Card, WorkflowInspection } from "../../contracts.ts";
import {
	exampleVisit,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
} from "./workflow-explorer-data.ts";
import land from "./workflow-land.json";
import { z } from "zod";

/** Captured native runs for the workflow preview workshop. */
export interface WorkflowSample {
	/** Native run card; labels, relationships and request enrichment omitted from this preview. */
	card: Card;
	/** Short label for the captured run. */
	label: string;
	/** Native system record containing this snapshot. */
	checkpoint: string;
	/** Native checkpoint update timestamp in UTC. */
	savedAt: string;
	/** Time the source records were read. */
	capturedAt: string;
	/** Named workflow and saved version. */
	definition: string;
	/** Definition source within the checkout. */
	source: string;
	/** Relationship between the diagram source and the historical checkpoint. */
	definitionNote: string;
	/** Saved XState value, displayed separately from the task's native status. */
	state: string;
	/** XState snapshot status, independent of native Beads status. */
	snapshotStatus: "active" | "done";
	/** Serializable structural machine config; no runtime code or checkpoint context. */
	machine: Record<string, unknown>;
}

const CAPTURED_AT = "2026-10-15T06:19:20.094086Z";
const DEFINITION_NOTE =
	"Chart extracted from checkout 1cbebd6dc38368e11acadd5759ea22eb8b3829d5. " +
	"Samples pair that captured structure with historical saved state. " +
	"Action implementations, context and task instruction bodies are omitted.";
const work = {
	id: "do-work",
	initial: "work",
	states: {
		work: {
			on: { COMPLETED: "done" },
		},
		done: { type: "final" },
	},
};

export const workflowSamples: WorkflowSample[] = [
	{
		label: "Landing · in progress",
		card: {
			id: "hv-s3faw.17",
			title: "Land PR https://github.com/codethread/hive/pull/9",
			status: "in_progress",
			assignee: "codex",
			updatedAt: "2026-10-15T06:17:20.856235Z",
			priority: 2,
			labels: [],
			beeAssignments: [],
			merges: [],
			isWorkflowGenerated: true,
		},
		checkpoint: "hv-w4pn0",
		savedAt: "2026-10-15T06:19:16.611433Z",
		capturedAt: CAPTURED_AT,
		definition: "land 3.0.0",
		source: ".workflows/land/workflow.ts",
		definitionNote: DEFINITION_NOTE,
		state: "check",
		snapshotStatus: "active",
		machine: land,
	},
	{
		label: "Agent work · in progress",
		card: {
			id: "hv-uvd5u.5",
			title:
				"Do work: Synthesize user corrections: portable Beeswax lock and explicitly pinned hook sections",
			status: "in_progress",
			assignee: "crimson-critical-octopus",
			updatedAt: "2026-10-15T06:11:00.729184Z",
			priority: 2,
			labels: [],
			beeAssignments: [],
			merges: [],
			isWorkflowGenerated: true,
		},
		checkpoint: "hv-61qnv",
		savedAt: "2026-10-15T06:16:30.335701Z",
		capturedAt: CAPTURED_AT,
		definition: "do-work 1.0.0",
		source: ".workflows/do-work/workflow.ts",
		definitionNote: DEFINITION_NOTE,
		state: "work",
		snapshotStatus: "active",
		machine: work,
	},
	{
		label: "Landing · completed",
		card: {
			id: "hv-3j97o.1",
			title: "Land worktree codex/hive-ui-bead-notes-design",
			status: "closed",
			assignee: "codex",
			updatedAt: "2026-10-15T04:52:19.878125Z",
			priority: 2,
			labels: [],
			beeAssignments: [],
			merges: [],
			isWorkflowGenerated: true,
		},
		checkpoint: "hv-g3zno",
		savedAt: "2026-10-15T04:52:20.698303Z",
		capturedAt: CAPTURED_AT,
		definition: "land 3.0.0",
		source: ".workflows/land/workflow.ts",
		definitionNote: DEFINITION_NOTE,
		state: "done",
		snapshotStatus: "done",
		machine: land,
	},
];

/** Pair frozen saved state with the chart captured for these samples. */
export function samplePreview(sample: WorkflowSample): WorkflowInspection {
	return {
		formatVersion: 1,
		runId: sample.card.id,
		title: sample.card.title,
		checkpoint: sample.checkpoint,
		savedAt: sample.savedAt,
		definition: {
			label: sample.definition,
			savedHash: "historical-sample",
			currentHash: "checkout-1cbebd6",
			sourceMatch: "compatible",
		},
		actors: [
			{
				id: "root",
				path: [],
				machine: sample.machine,
				snapshot: { value: sample.state, status: sample.snapshotStatus },
				instructions: sampleInstructions(sample),
			},
		],
	};
}

// Captured graphs use synthetic briefs; no private checkpoint instructions are copied into fixtures.
function sampleInstructions(
	sample: WorkflowSample,
): WorkflowInspection["actors"][number]["instructions"] {
	const states = z
		.record(z.string(), z.object({ id: z.string().optional() }))
		.parse(sample.machine["states"]);
	const { context } = exampleVisit(sampleContext, "example").snapshot;
	return {
		[String(sample.machine["id"])]: { kind: "none" },
		...Object.fromEntries(
			Object.entries(states).map(
				([key, state]): [string, WorkflowInspection["actors"][number]["instructions"][string]] => {
					const id = state.id ?? `${String(sample.machine["id"])}.${key}`;
					if (sample.definition.startsWith("land")) {
						const step = stepIds.find((candidate) => candidate === key)!;
						if (steps[step].kind !== "task") {
							return [id, { kind: "none" }];
						}
						const brief = renderInstructions(step, context);
						return [
							id,
							key === sample.state
								? {
										kind: "frozen",
										title: brief.title,
										instructions: brief.instructions,
										bead: sample.card.id,
									}
								: { kind: "rendered", title: brief.title, instructions: brief.instructions },
						];
					}
					return [
						id,
						key === sample.state && key !== "done"
							? {
									kind: "frozen",
									title: sample.card.title,
									instructions:
										"Inspect the graph and use the divider to adjust the instructions panel.",
									bead: sample.card.id,
								}
							: { kind: "none" },
					];
				},
			),
		),
	};
}
