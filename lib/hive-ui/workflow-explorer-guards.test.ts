import {
	advance,
	availableOutcomes,
	exampleVisit,
	sampleContext,
	transitions,
} from "./src/stories/workflow-explorer-data.ts";
import { expect, test } from "bun:test";
import { samplePreview, workflowSamples } from "./src/stories/workflow-samples.ts";
import { workflowActorGraph } from "./src/workflow-graph.ts";

const cases = (
	[
		{ outcome: "passed", target: "finish" },
		{ outcome: "integrated", target: "verify" },
	] as const
).map(({ outcome, target }) => {
	let { snapshot } = exampleVisit(sampleContext, "initial");
	for (const command of [outcome, "approved"]) {
		const choice = availableOutcomes(snapshot, sampleContext).find(
			(entry) => entry.command === command,
		)!;
		({ snapshot } = advance(snapshot, choice.event));
	}
	return { outcome, target, snapshot };
});

test.each(cases)(
	"Land walkthrough predicts the guarded $target route after $outcome",
	({ snapshot, target }) => {
		const choice = availableOutcomes(snapshot, sampleContext).find(
			(entry) => entry.command === "approved",
		)!;
		const next = advance(snapshot, choice.event).snapshot;
		expect(choice.target).toBe(target);
		expect(next.value).toBe(choice.target);
	},
);

const landSample = workflowSamples.find((entry) => entry.definition.startsWith("land"))!;
const { graph: fixtureGraph } = workflowActorGraph(samplePreview(landSample).actors[0]!);

test("Land preview fixture preserves actual transition targets and guard labels", () => {
	for (const [source, edges] of Object.entries(transitions)) {
		expect(
			fixtureGraph.transitions[`land.${source}`]!.map(({ event, label, target }) => ({
				event,
				label,
				target,
			})),
		).toEqual(
			edges.map(({ event, label, target }) => ({ event, label, target: `land.${target}` })),
		);
	}
});
