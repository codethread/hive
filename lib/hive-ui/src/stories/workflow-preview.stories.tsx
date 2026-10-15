import { HttpResponse, http } from "msw";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { samplePreview, workflowSamples } from "./workflow-samples.ts";
import { BeadCard } from "../bead-card.tsx";

const meta = {
	title: "Beads/Workflow preview",
	component: BeadCard,
	args: { card: workflowSamples[0]!.card },
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/workflow/:id", ({ params }) => {
				const sample = workflowSamples.find((entry) => entry.card.id === params["id"])!;
				return HttpResponse.json(samplePreview(sample));
			}),
		],
	},
	render: () => (
		<div className="workflow-workshop">
			<header className="workflow-workshop-header">
				<div>
					<p className="workflow-eyebrow">HIVE / WORKFLOW PREVIEW</p>
					<h1>See the workflow behind the bead</h1>
					<p>Open a workflow icon to inspect its saved state.</p>
				</div>
			</header>
			<div className="workflow-source-notice">
				<span className="workflow-status-dot" />
				Existing Hive beads · frozen checkpoint samples
			</div>
			<div className="workflow-sample-board">
				{workflowSamples.map((sample) => (
					<section key={sample.card.id} className="workflow-sample-column">
						<h2>
							{sample.label}
							<span>1</span>
						</h2>
						<BeadCard card={sample.card} />
						<p className="workflow-card-caption">
							Saved state <code>{sample.state}</code>
						</p>
					</section>
				))}
			</div>
		</div>
	),
} satisfies Meta<typeof BeadCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Modal: Story = {};
export const Unavailable: Story = {
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/workflow/:id", () =>
				HttpResponse.json(
					{ message: "The workflow definition is unavailable in this repository." },
					{ status: 503 },
				),
			),
		],
	},
};

/** Synthetic retained child complements the captured single-actor runs. */
export const NestedActors: Story = {
	args: {
		card: {
			...workflowSamples[0]!.card,
			id: "fixture-nested",
			title: "Nested workflow actors (synthetic sample)",
		},
	},
	render: (args) => (
		<div className="max-w-md p-6">
			<BeadCard card={args.card} />
		</div>
	),
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/workflow/:id", () => {
				const preview = samplePreview(workflowSamples[1]!);
				return HttpResponse.json({
					...preview,
					runId: "fixture-nested",
					title: "Nested workflow actors (synthetic sample)",
					definition: { ...preview.definition, label: "nested sample" },
					actors: [
						...preview.actors,
						{
							id: "child",
							path: ["reviewer"],
							machine: {
								id: "reviewer",
								initial: "review",
								states: { review: { on: { APPROVED: "done" } }, done: { type: "final" } },
							},
							snapshot: { value: "review", status: "active" },
						},
					],
				});
			}),
		],
	},
};
