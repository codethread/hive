import { HttpResponse, http } from "msw";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import {
	workflowInspectionSchema,
	workflowSimulationRequestSchema,
	workflowSimulationSchema,
} from "../../contracts.ts";
import { WorkflowDiagram } from "../workflow-diagram.tsx";
import captures from "./workflow-nested-bees.json";
import { preferences } from "../data.ts";
import { useStore } from "zustand";

const saved = {
	started: workflowInspectionSchema.parse(captures.started),
	mixed: workflowInspectionSchema.parse(captures.mixed),
	handoff: workflowInspectionSchema.parse(captures.handoff),
};
const childSaved = workflowSimulationSchema.parse(captures.childSaved);
const childDone = workflowSimulationSchema.parse(captures.childSimulation);

export const nestedBeesStarting = {
	name: "Nested bees · published requests",
	render: () => <NestedBeeExample stage="started" />,
	parameters: { msw: handlers() },
	play: async () => {
		await openChildWorkflow("Api");
		await screen.findByText(/Bee kind: worker · Original published request:/u);
		await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
			"nested-worker.implement",
		);
	},
};

export const nestedBeesMixed = {
	name: "Nested bees · different branch stages",
	render: () => <NestedBeeExample stage="mixed" />,
	parameters: { msw: handlers() },
	// eslint-disable-next-line max-statements -- Verify focus, child inspection and return navigation together.
	play: async () => {
		await userEvent.click(await screen.findByRole("button", { name: "Collapse Team / Interface" }));
		await userEvent.click(await screen.findByRole("button", { name: "Focus Team / Api" }));
		await openChildWorkflow("Api");
		await screen.findByText(/Bee kind: reviewer · Original published request:/u);
		await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
			"nested-worker.verify",
		);
		await returnToWorkflow();
		await expect(
			screen.queryByRole("button", { name: "Focus Team / Interface" }),
		).not.toBeInTheDocument();
		await returnToWorkflow();
		await userEvent.click(await screen.findByRole("button", { name: "Expand Team / Interface" }));
		await openChildWorkflow("Interface");
		await screen.findByText(/Bee kind: worker · Original published request:/u);
		await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
			"nested-worker.implement",
		);
	},
};

export const nestedBeesHandoff = {
	name: "Nested bees · driver summary",
	render: () => <NestedBeeExample stage="handoff" />,
	parameters: { msw: handlers() },
	play: async () => {
		await screen.findByText("Summarize both branches");
		await expect(screen.queryByRole("combobox", { name: "Actor" })).not.toBeInTheDocument();
	},
};

export const nestedBeesUnsupported = {
	name: "Nested bees · root simulation unsupported",
	render: () => <NestedBeeExample stage="mixed" />,
	parameters: { msw: handlers() },
	play: async () => {
		await userEvent.click(await screen.findByRole("button", { name: "Simulate" }));
		await screen.findByRole("alert");
		await expect(screen.getByText(captures.unsupported.message)).toBeVisible();
	},
};

export const nestedBeeChildSimulation = {
	name: "Nested bees · isolated child simulation",
	render: () => <NestedBeeExample stage="mixed" />,
	parameters: { msw: handlers() },
	play: async () => {
		await openChildWorkflow("Api");
		await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
		await screen.findByRole("combobox", { name: "Outcome" });
		await screen.findByText(/Bee kind: reviewer · Original published request:/u);
		await userEvent.click(screen.getByRole("button", { name: "Use example event data" }));
		await userEvent.click(screen.getByRole("button", { name: "Apply event" }));
		await waitFor(async () => {
			await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
				"nested-worker.done",
			);
		});
		await userEvent.click(screen.getByRole("button", { name: "Saved" }));
		await returnToWorkflow();
		await expect(screen.getByRole("combobox", { name: "Inspect step" })).not.toHaveValue(
			"nested-bees.handoff",
		);
	},
};

function NestedBeeExample({ stage }: { stage: keyof typeof saved }) {
	const theme = useStore(preferences, (state) => state.theme);
	return (
		<div className="flex h-dvh flex-col">
			<p className="px-6 py-3 text-sm text-muted">
				Captured from the nested-bees workflow using memory Beads and mocked Bee dispatch; no
				workers were launched. Child machines coordinate visits, each with its own request. Root
				simulation rejects child coordination; an isolated child simulation leaves its parent
				unchanged.
			</p>
			<WorkflowDiagram
				inspection={saved[stage]}
				colony="nested-bees"
				theme={theme === "paper" ? "light" : "dark"}
			/>
		</div>
	);
}

function handlers() {
	return [
		http.post("/api/colonies/nested-bees/workflow/:id/simulate", async ({ request }) => {
			const body = workflowSimulationRequestSchema.parse(await request.json());
			if (body.actorId === "actor:[]" && body.savedAt !== saved.handoff.savedAt) {
				return HttpResponse.json(captures.unsupported, { status: 400 });
			}
			if (
				body.actorId === childSaved.actor.id &&
				body.start.kind === "saved" &&
				body.savedAt === saved.mixed.savedAt
			) {
				if (body.events.length === 0) {
					return HttpResponse.json(childSaved);
				}
				if (
					JSON.stringify(body.events) ===
					JSON.stringify([{ node: "nested-worker.verify", command: "next", data: {} }])
				) {
					return HttpResponse.json(childDone);
				}
			}
			return HttpResponse.json(
				{ message: "This Storybook fixture has no captured response for that replay." },
				{ status: 400 },
			);
		}),
	];
}

async function openChildWorkflow(name: string) {
	await userEvent.click(await screen.findByRole("button", { name: `Open ${name} workflow` }));
	await screen.findByRole("application", { name: "Workflow diagram" });
	await expect(
		within(screen.getByRole("navigation", { name: "State scope" })).getByRole("button", {
			name,
		}),
	).toHaveAttribute("aria-current", "page");
}

async function returnToWorkflow() {
	await userEvent.click(
		within(screen.getByRole("navigation", { name: "State scope" })).getByRole("button", {
			name: "Workflow",
		}),
	);
	await screen.findByRole("application", { name: "Workflow diagram" });
}
