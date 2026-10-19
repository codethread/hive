/* eslint-disable import/max-dependencies -- Stories compose modal, canvas, examples and typed fixtures. */
/* eslint-disable oxc/no-map-spread -- Story payloads retain immutable captured actor fixtures. */
import { HttpResponse, delay, http } from "msw";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { exampleHandlers, exampleWorkflows } from "./workflow-examples.ts";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import {
	nestedBeeChildSimulation,
	nestedBeesHandoff,
	nestedBeesMixed,
	nestedBeesStarting,
	nestedBeesUnsupported,
} from "./workflow-nested-bees.tsx";
import { samplePreview, workflowSamples } from "./workflow-samples.ts";
import { sampleSimulation, workflowHandlers } from "./workflow-simulation-fixture.ts";
import type { ComponentProps } from "react";
import type { ExampleWorkflow } from "./workflow-examples.ts";
import { WorkflowExamples } from "./workflow-example-view.tsx";
import { WorkflowExplorer } from "./workflow-explorer.tsx";
import { WorkflowIndicator } from "../workflow-preview.tsx";
import { workflowSimulationRequestSchema } from "../../contracts.ts";

export type PreviewArgs = ComponentProps<typeof WorkflowIndicator> & { workflow: ExampleWorkflow };
const REPLAY_DELAY_MS = 100;
const VIEWPORT_SETTLE_MS = 500;
const FAILED_READ = 2;
const polling = pollingHandlers();
const retirement = retirementHandlers();
const recovery = recoveryHandlers();
const meta = {
	component: WorkflowIndicator,
	args: { id: workflowSamples[0]!.card.id, isWorkflowGenerated: true, workflow: "Parallel" },
	argTypes: { workflow: { control: "select", options: exampleWorkflows } },
	parameters: {
		controls: { disable: true },
		msw: workflowHandlers(),
	},
	render: (args) => (
		<div className="max-w-md p-6">
			<WorkflowIndicator id={args.id} isWorkflowGenerated={args.isWorkflowGenerated} />
		</div>
	),
} satisfies Meta<PreviewArgs>;
export const workflowPreviewMeta = meta;
type Story = StoryObj<typeof meta>;
export const Modal: Story = {
	name: "Active run",
	play: async (context) => {
		await openPreview(context);
		const divider = screen.getByRole("separator", { name: "Resize instructions" });
		const { x: clientX, y: clientY } = divider.getBoundingClientRect();
		await userEvent.pointer({
			target: divider,
			coords: { clientX, clientY },
			keys: "[MouseLeft]",
		});
		await expect(screen.getByRole("dialog", { name: "Workflow preview" })).toBeVisible();
	},
};
export const Completed: Story = {
	name: "Completed run",
	args: { id: workflowSamples.find((sample) => sample.snapshotStatus === "done")!.card.id },
	play: openPreview,
};
export const Simulation: Story = {
	play: async (context) => {
		await openPreview(context);
		await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
		await screen.findByRole("combobox", { name: "Outcome" });
		await context.step("Reject incomplete event data", async () => {
			await userEvent.click(screen.getByRole("button", { name: "Apply event" }));
			await screen.findByText("Simulation could not update");
			await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
				"land.check",
			);
		});
		await context.step("Walk forward, back and reset", async () => {
			await applyExample();
			await expectStep("land.review");
			await userEvent.click(screen.getByRole("button", { name: "Back" }));
			await expectStep("land.check");
			await applyExample();
			await expectStep("land.review");
			await userEvent.click(screen.getByRole("button", { name: "Reset" }));
			await expectStep("land.check");
		});
		await context.step("Restore the saved run", async () => {
			await userEvent.click(screen.getByRole("button", { name: "Saved" }));
			await screen.findByText(`Published task instructions · ${context.args.id}`);
			await expect(screen.queryByRole("combobox", { name: "Outcome" })).not.toBeInTheDocument();
		});
		await context.step("Leave the walkthrough at Review", async () => {
			await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
			await screen.findByRole("combobox", { name: "Outcome" });
			await applyExample();
			await expectStep("land.review");
		});
	},
};
export const InitialOrigin: Story = {
	name: "Initial input after saved failure",
	parameters: {
		msw: [
			http.post("/api/colonies/:colony/workflow/:id/simulate", async ({ request }) => {
				try {
					const body = workflowSimulationRequestSchema.parse(await request.json());
					if (body.start.kind === "saved") {
						return HttpResponse.json(
							{
								message: "Active invocation, timers or actor references require live coordination",
							},
							{ status: 400 },
						);
					}
					return HttpResponse.json(sampleSimulation(workflowSamples[0]!, body));
				} catch (error) {
					return HttpResponse.json(
						{ message: error instanceof Error ? error.message : String(error) },
						{ status: 400 },
					);
				}
			}),
			...workflowHandlers(),
		],
	},
	play: async (context) => {
		await openPreview(context);
		await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
		await screen.findByText("Simulation unavailable");
		await userEvent.click(screen.getByRole("button", { name: "Close toast" }));
		await context.step("Reject empty initial input, then start from explicit JSON", async () => {
			await userEvent.click(screen.getByText("From beginning", { exact: true }));
			await userEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
			await screen.findByText("Simulation unavailable");
			await expect(
				screen.queryByRole("button", { name: "Use example initial input" }),
			).not.toBeInTheDocument();
			const draft = screen.getByRole("textbox", { name: "Initial input" });
			await userEvent.clear(draft);
			await userEvent.paste(
				JSON.stringify({
					request: "Explore the initial prefix",
					target: { kind: "worktree", branch: "example/initial" },
					canonicalRoot: "/example/hive",
					beadsDb: "/example/tracker/beads.db",
					completedTasks: [],
				}),
			);
			await userEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
			await expectStep("land.check");
		});
	},
};
export const Examples: Story = {
	parameters: { controls: { disable: false, include: ["workflow"] }, msw: exampleHandlers() },
	render: ({ workflow }) => <WorkflowExamples workflow={workflow} />,
};
export const InstructionPanel: Story = {
	name: "Canvas and instructions",
	render: () => <WorkflowExplorer />,
};
export const Unavailable: Story = {
	play: async ({ args, canvas }) => {
		await userEvent.click(
			await canvas.findByRole("button", { name: `View workflow for ${args.id}` }),
		);
		await screen.findByText("Workflow unavailable");
	},
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

export const NestedActors: Story = nestedBeesMixed;
export const NestedBeesStarting: Story = nestedBeesStarting;
export const NestedBeesHandoff: Story = nestedBeesHandoff;
export const NestedBeesUnsupported: Story = nestedBeesUnsupported;
export const NestedBeeChildSimulation: Story = nestedBeeChildSimulation;

export const LivePolling: Story = {
	name: "Saved progress during simulation",
	beforeEach: polling.reset,
	parameters: { msw: [...polling.handlers, ...workflowHandlers()] },
	// eslint-disable-next-line max-statements -- Capture presentation before polling and verify explicit simulation exit.
	play: async (context) => {
		await openPreview(context);
		const diagram = await screen.findByRole("application", { name: "Workflow diagram" });
		const viewport = diagram.querySelector(".react-flow__viewport");
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zoom" }), "workflow");
		await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
		await screen.findByRole("combobox", { name: "Outcome" });
		await delay(VIEWPORT_SETTLE_MS);
		const transform = viewport!.getAttribute("style");
		const divider = screen.getByRole("separator", { name: "Resize instructions" });
		const size = divider.getAttribute("aria-valuenow");
		await context.step(
			"Keep the simulation anchored when a poll finds a changed checkpoint",
			async () => {
				await waitFor(
					async () => {
						await expect(
							screen.getByText(/The saved checkpoint or diagram source has changed/u),
						).toBeVisible();
					},
					{ timeout: 10_000 },
				);
				await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
					"land.check",
				);
				await expect(screen.getByRole("combobox", { name: "Zoom" })).toHaveValue("workflow");
				await delay(VIEWPORT_SETTLE_MS);
				await expect(diagram.querySelector(".react-flow__viewport")).toBe(viewport);
				await expect(viewport!.getAttribute("style")).toBe(transform);
				await expect(divider.getAttribute("aria-valuenow")).toBe(size);
			},
		);
		await context.step("Returning to Saved shows the refreshed checkpoint", async () => {
			await userEvent.click(screen.getByRole("button", { name: "Saved" }));
			await expectStep("land.review");
		});
	},
};

export const RefreshRecovery: Story = {
	name: "Refresh recovery",
	beforeEach: recovery.reset,
	parameters: { msw: recovery.handlers },
	play: async (context) => {
		await openPreview(context);
		const diagram = await screen.findByRole("application", { name: "Workflow diagram" });
		const viewport = diagram.querySelector(".react-flow__viewport")!;
		await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zoom" }), "workflow");
		await delay(VIEWPORT_SETTLE_MS);
		const transform = viewport.getAttribute("style");
		const divider = screen.getByRole("separator", { name: "Resize instructions" });
		const size = divider.getAttribute("aria-valuenow");
		await context.step(
			"Keep the canvas stable through refresh failure and recovery",
			// eslint-disable-next-line max-statements -- Verify presentation through one failure and recovery cycle.
			async () => {
				await userEvent.click(screen.getByRole("button", { name: "Refresh workflow state" }));
				await screen.findByText("Workflow could not update");
				await delay(VIEWPORT_SETTLE_MS);
				await expect(viewport.getAttribute("style")).toBe(transform);
				await expect(diagram.querySelector(".react-flow__viewport")).toBe(viewport);
				await userEvent.click(screen.getByRole("button", { name: "Refresh workflow state" }));
				await waitFor(async () => {
					await expect(screen.queryByText("Workflow could not update")).not.toBeInTheDocument();
				});
				await delay(VIEWPORT_SETTLE_MS);
				await expect(screen.getByTitle("Current saved state")).toHaveTextContent("review");
				await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(
					"land.check",
				);
				await expect(screen.getByRole("combobox", { name: "Zoom" })).toHaveValue("workflow");
				await expect(viewport.getAttribute("style")).toBe(transform);
				await expect(divider.getAttribute("aria-valuenow")).toBe(size);
			},
		);
	},
};

function recoveryHandlers() {
	let reads = 0;
	return {
		reset: () => {
			reads = 0;
		},
		handlers: [
			http.get("/api/colonies/:colony/workflow/:id", ({ request }) => {
				const preview = samplePreview(workflowSamples[0]!);
				if (new URL(request.url).searchParams.get("checkpointOnly") !== "true") {
					reads += 1;
				}
				if (reads === FAILED_READ) {
					return HttpResponse.json({ message: "Workflow inspection failed" }, { status: 503 });
				}
				if (reads > FAILED_READ) {
					preview.savedAt = "2026-10-17T15:00:00Z";
					preview.actors[0]!.snapshot.value = "review";
				}
				return HttpResponse.json(preview);
			}),
		],
	};
}

export const ActorRetirement: Story = {
	name: "Retired actor during simulation",
	beforeEach: retirement.reset,
	parameters: { msw: retirement.handlers },
	play: async (context) => {
		await openPreview(context);
		await context.step(
			"Pin a child simulation through pending replay and actor retirement",
			// eslint-disable-next-line max-statements -- Verify one child retirement across pending replay and explicit exit.
			async () => {
				await userEvent.click(
					await screen.findByRole("button", { name: "Open Reviewer workflow" }),
				);
				await screen.findByRole("application", { name: "Workflow diagram" });
				await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
				await userEvent.click(screen.getByRole("button", { name: "Refresh workflow state" }));
				await screen.findByText(/The saved checkpoint or diagram source has changed/u);
				await screen.findByRole("combobox", { name: "Outcome" });
				await expect(screen.getByRole("button", { name: "Workflow" })).toBeDisabled();
				await expect(screen.getByRole("button", { name: "Reviewer" })).toHaveAttribute(
					"aria-current",
					"page",
				);
				await userEvent.click(screen.getByRole("button", { name: "Saved" }));
				await screen.findByText(/Actor child is no longer retained/u);
				await expect(screen.queryByRole("combobox", { name: "Actor" })).not.toBeInTheDocument();
				await expect(screen.getByRole("application", { name: "Workflow diagram" })).toBeVisible();
			},
		);
	},
};

function retirementHandlers() {
	let reads = 0;
	return {
		reset: () => {
			reads = 0;
		},
		handlers: [
			http.get("/api/colonies/:colony/workflow/:id", () => {
				reads += 1;
				const preview = samplePreview(workflowSamples[0]!);
				if (reads === 1) {
					preview.actors.push({ ...preview.actors[0]!, id: "child", path: ["reviewer"] });
				} else {
					preview.savedAt = "2026-10-17T15:00:00Z";
				}
				return HttpResponse.json(preview);
			}),
			http.post("/api/colonies/:colony/workflow/:id/simulate", async ({ request }) => {
				const body = workflowSimulationRequestSchema.parse(await request.json());
				await delay(REPLAY_DELAY_MS);
				const response = sampleSimulation(workflowSamples[0]!, body);
				response.actor.id = body.actorId;
				response.actor.path = ["reviewer"];
				return HttpResponse.json(response);
			}),
		],
	};
}

function pollingHandlers() {
	let changed = false;
	return {
		reset: () => {
			changed = false;
		},
		handlers: [
			http.get("/api/colonies/:colony/workflow/:id", ({ request }) => {
				const original = samplePreview(workflowSamples[0]!);
				if (new URL(request.url).searchParams.get("checkpointOnly") === "true") {
					changed = true;
				}
				if (!changed) {
					return HttpResponse.json(original);
				}
				return HttpResponse.json({
					...original,
					savedAt: "2026-10-17T15:00:00Z",
					actors: original.actors.map((actor) => ({
						...actor,
						snapshot: { value: "review", status: "active" },
					})),
				});
			}),
		],
	};
}

async function openPreview({ args, canvas }: Parameters<NonNullable<Story["play"]>>[0]) {
	await userEvent.click(
		await canvas.findByRole("button", { name: `View workflow for ${args.id}` }),
	);
	await screen.findByRole("combobox", { name: "Inspect step" });
}

async function applyExample() {
	await userEvent.click(screen.getByRole("button", { name: "Use example event data" }));
	await userEvent.click(screen.getByRole("button", { name: "Apply event" }));
}

async function expectStep(value: string) {
	await waitFor(async () => {
		await expect(screen.getByRole("combobox", { name: "Inspect step" })).toHaveValue(value);
	});
}
