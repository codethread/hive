import { HttpResponse, http } from "msw";
import type {
	WorkflowOutcome,
	WorkflowSimulation,
	WorkflowSimulationRequest,
} from "../../contracts.ts";
import {
	advance,
	exampleVisit,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
} from "./workflow-explorer-data.ts";
import { commandSchemas, inputSchema, machine } from "../../../../.workflows/land/workflow.ts";
import { samplePreview, workflowSamples } from "./workflow-samples.ts";
import type { LandSnapshot } from "./workflow-explorer-data.ts";
import type { WorkflowSample } from "./workflow-samples.ts";
import { initialTransition } from "xstate";
import { workflowSimulationRequestSchema } from "../../contracts.ts";
import { z } from "zod";

export function workflowHandlers(samples: WorkflowSample[] = workflowSamples) {
	return [
		http.get("/api/colonies/:colony/workflow/:id", ({ params, request }) => {
			const selected = samples.find((entry) => entry.card.id === params["id"])!;
			if (new URL(request.url).searchParams.get("outcomeOnly") === "true") {
				return HttpResponse.json(sampleOutcome(selected));
			}
			return HttpResponse.json(samplePreview(selected));
		}),
		http.post("/api/colonies/:colony/workflow/:id/simulate", async ({ params, request }) => {
			try {
				const selected = samples.find((entry) => entry.card.id === params["id"])!;
				return HttpResponse.json(sampleSimulation(selected, await request.json()));
			} catch (error) {
				return HttpResponse.json(
					{ message: error instanceof Error ? error.message : String(error) },
					{ status: 400 },
				);
			}
		}),
	];
}

/** Illustrative authority for Storybook, separate from the captured structural diagram. */
export function sampleOutcome(selected: WorkflowSample): WorkflowOutcome {
	const result: WorkflowOutcome = {
		runId: selected.card.id,
		checkpoint: selected.checkpoint,
		savedAt: selected.savedAt,
		updatedAt: selected.card.updatedAt,
		nativeStatus: selected.card.status,
		completion: null,
		outcome: { kind: "pending" },
		labelsCurrent: true,
	};
	if (selected.snapshotStatus === "done") {
		const completion = {
			scope: "run",
			outcome: "succeeded",
			reason: "Illustrative workflow completed.",
			state: "confirmed",
			closedAt: selected.card.updatedAt,
		} as const;
		result.completion = completion;
		result.outcome = {
			kind: "terminal",
			closedAt: completion.closedAt,
			fact: {
				runId: selected.card.id,
				scope: completion.scope,
				outcome: completion.outcome,
				reason: completion.reason,
			},
		};
	}
	return result;
}

export function sampleSimulation(selected: WorkflowSample, raw: unknown): WorkflowSimulation {
	if (!selected.definition.startsWith("land")) {
		throw new Error("This fixture provides simulation for the Land workflow.");
	}
	const request = workflowSimulationRequestSchema.parse(raw);
	const inspection = samplePreview(selected);
	let snapshot = sampleStart(selected, request.start);
	for (const event of request.events) {
		snapshot = sampleEvent(snapshot, event);
	}
	return {
		formatVersion: 1,
		runId: inspection.runId,
		actor: {
			...inspection.actors[0]!,
			snapshot: { value: snapshot.value, status: snapshot.status },
			instructions: sampleInstructions(snapshot),
		},
		choices: sampleChoices(snapshot),
		inputSchema: z.toJSONSchema(inputSchema, { io: "input" }),
	};
}

function sampleStart(
	selected: WorkflowSample,
	start: WorkflowSimulationRequest["start"],
): LandSnapshot {
	if (start.kind === "initial") {
		const [snapshot] = initialTransition(machine, inputSchema.parse(start.input));
		return snapshot;
	}
	const value = stepIds.find((id) => id === selected.state)!;
	return machine.resolveState({
		value,
		context: exampleVisit(sampleContext, "example").snapshot.context,
	});
}

function sampleEvent(
	snapshot: LandSnapshot,
	event: WorkflowSimulationRequest["events"][number],
): LandSnapshot {
	const current = steps[snapshot.value];
	if (current.kind !== "task" || event.node !== `land.${snapshot.value}`) {
		throw new Error("Choose an outcome from the simulated current step.");
	}
	const [, type] = Object.entries(current.metadata.commands).find(
		([name]) => name === event.command,
	)!;
	const data = sampleCommand(event.command).parse(event.data);
	const next = { type, data };
	if (!snapshot.can(next)) {
		throw new Error("This outcome is blocked by the guard for this event data.");
	}
	return advance(snapshot, next).snapshot;
}

function sampleInstructions(snapshot: LandSnapshot): WorkflowSimulation["actor"]["instructions"] {
	const instructions = Object.fromEntries(
		stepIds.map((id): [string, WorkflowSimulation["actor"]["instructions"][string]] => {
			if (steps[id].kind !== "task") {
				return [`land.${id}`, { kind: "none" as const }];
			}
			const rendered = renderInstructions(id, snapshot.context);
			return [
				`land.${id}`,
				{ kind: "rendered" as const, title: rendered.title, instructions: rendered.instructions },
			];
		}),
	);
	return { land: { kind: "none" }, ...instructions };
}

function sampleChoices(snapshot: LandSnapshot): WorkflowSimulation["choices"] {
	const current = steps[snapshot.value];
	if (current.kind !== "task") {
		return [];
	}
	return Object.entries(current.metadata.commands).map(([command, event]) => ({
		node: `land.${snapshot.value}`,
		title: current.title,
		command,
		event,
		schema: z.toJSONSchema(sampleCommand(command), { io: "input" }),
	}));
}

function sampleCommand(command: string) {
	const [, schema] = Object.entries(commandSchemas).find(([name]) => name === command)!;
	return schema;
}
