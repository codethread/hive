import {
	advance,
	availableOutcomes,
	exampleVisit,
	renderInstructions,
	sampleContext,
	stepIds,
	steps,
	transitions,
} from "./src/stories/workflow-explorer-data.ts";

import { expect, test } from "bun:test";
import { samplePreview, workflowSamples } from "./src/stories/workflow-samples.ts";
import { sampleSimulation } from "./src/stories/workflow-simulation-fixture.ts";

const exampleContext = exampleVisit(sampleContext, "example").snapshot.context;

test("Land graph shows review and delivery findings returning to checked work", () => {
	expect(stepIds).toEqual(["check", "review", "finish", "verify", "local-update", "done"]);
	for (const stage of ["review", "finish"] as const) {
		expect(transitions[stage].map((edge) => [edge.event, edge.target])).toContainEqual([
			"CHANGES",
			"check",
		]);
	}
	expect(steps.review).toMatchObject({ kind: "task", bee: "reviewer" });
});

test("Land walkthrough follows real outcomes from checked work through local update", () => {
	let { snapshot } = exampleVisit(sampleContext, "initial");
	for (const command of ["passed", "approved", "next", "next", "next"]) {
		const outcome = availableOutcomes(snapshot, sampleContext).find(
			(entry) => entry.command === command,
		)!;
		expect(outcome.enabled).toBe(true);
		({ snapshot } = advance(snapshot, outcome.event));
		expect(snapshot.value).toBe(outcome.target);
	}
	expect(snapshot.status).toBe("done");
});

test("Land worker instructions render retained evidence and the final caller brief", () => {
	const instructions = stepIds
		.filter((id) => steps[id].kind === "task")
		.map((id) => renderInstructions(id, exampleContext).instructions);
	expect(instructions.every((text) => text.includes(sampleContext.evidence))).toBe(true);
	expect(renderInstructions("done", exampleContext).instructions).toContain(sampleContext.request);
});

test("Land preview samples use the same chart as their simulation", () => {
	for (const sample of workflowSamples.filter((entry) => entry.definition.startsWith("land"))) {
		const preview = samplePreview(sample);
		expect(Object.keys(preview.actors[0]!.machine["states"]!)).toEqual(stepIds);
		const simulated = sampleSimulation(sample, {
			checkpoint: sample.checkpoint,
			savedAt: sample.savedAt,
			definitionHash: preview.definition.currentHash,
			actorId: "root",
			start: { kind: "saved" },
			events: [],
		});
		expect(simulated.actor.snapshot).toEqual(preview.actors[0]!.snapshot);
	}
});
