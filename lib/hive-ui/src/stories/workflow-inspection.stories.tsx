import {
	Completed as CompletedCase,
	Unavailable as UnavailableCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import { HttpResponse, http } from "msw";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import { samplePreview, workflowSamples } from "./workflow-samples.ts";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";
import type { WorkflowLifecycle } from "../../contracts.ts";
import { sampleWorkflowView } from "./workflow-lifecycle-fixture.ts";
import { workflowHandlers } from "./workflow-simulation-fixture.ts";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Inspection",
} satisfies Meta<PreviewArgs>;
export default meta;

export const Completed = { ...CompletedCase, name: "Completed run" };
export const Unavailable = { ...UnavailableCase, name: "Unavailable" };

export const SucceededWithoutGraph = nativeCase("succeeded", { kind: "resolved" }, true);
export const FailedAcknowledged = nativeCase("failed", {
	kind: "acknowledged",
	actor: "reviewer",
	acknowledgedAt: "2026-10-18T12:00:00Z",
	reason: "Follow-up accepted",
});
export const FailedReplaced = nativeCase("failed", {
	kind: "superseded",
	replacementIds: ["example-replacement"],
});
export const CancelledReplaced = nativeCase(
	"cancelled",
	{ kind: "superseded", replacementIds: ["example-replacement"] },
	true,
);

function nativeCase(
	outcome: "succeeded" | "failed" | "cancelled",
	resolution: WorkflowLifecycle["resolution"],
	missingGraph = false,
): StoryObj<typeof meta> {
	return {
		parameters: {
			msw: [
				http.get("/api/colonies/:colony/workflow/:id", () => {
					const view = sampleWorkflowView(samplePreview(workflowSamples[0]!));
					view.nativeStatus = "closed";
					view.lifecycle = {
						kind: "terminal",
						closedAt: "2026-10-18T11:00:00Z",
						fact: {
							kind: "busybee-lifecycle",
							formatVersion: 1,
							scope: "run",
							runId: view.runId,
							outcome,
							reason: "Synthetic native lifecycle example",
						},
					};
					view.resolution = resolution;
					if (missingGraph) {
						view.diagram = {
							kind: "unavailable",
							reason: "definition_missing",
							message: "The authored definition is unavailable.",
						};
					}
					return HttpResponse.json(view);
				}),
				...workflowHandlers(),
			],
		},
		play: async ({ args, canvas }) => {
			await userEvent.click(
				await canvas.findByRole("button", { name: `View workflow for ${args.id}` }),
			);
			const banner = await screen.findByRole("region", { name: "Workflow lifecycle" });
			await expect(banner).toHaveTextContent(
				`Workflow: ${{ succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" }[outcome]}`,
			);
			await expect(banner).toHaveTextContent("Native task: closed");
			await (missingGraph
				? expect(await screen.findByRole("alert")).toHaveTextContent("Diagram unavailable")
				: screen.findByRole("combobox", { name: "Inspect step" }));
			if (resolution.kind === "superseded") {
				await expect(screen.getByRole("link", { name: "example-replacement" })).toHaveAttribute(
					"href",
					"/colonies/storybook?bead=example-replacement",
				);
			}
		},
	};
}
