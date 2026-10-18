/// <reference types="vite/client" />
import {
	Examples as ExamplesCase,
	InstructionPanel as InstructionPanelCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";
import { WorkflowHierarchyStress } from "./workflow-hierarchy.tsx";
// eslint-disable-next-line import/default -- Vite imports the stress fixture as source text.
import hierarchySource from "./workflow-hierarchy-model.ts?raw";
// eslint-disable-next-line eslint/no-restricted-imports, import/default -- Show the authored chart as text.
import parallelSource from "../../../busybee/examples/parallel/workflow.ts?raw";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Canvas",
} satisfies Meta<PreviewArgs>;
export default meta;

export const InstructionPanel = { ...InstructionPanelCase, name: "Canvas and instructions" };
export const Examples = { ...ExamplesCase, name: "Examples" };

export const ParallelStates = {
	...ExamplesCase,
	name: "Parallel states",
	args: { workflow: "Parallel" },
	parameters: {
		...ExamplesCase.parameters,
		controls: { disable: true },
		docs: {
			codePanel: true,
			source: { code: parallelSource, language: "typescript", type: "code" },
		},
	},
	play: async (context) => {
		await context.step("Advance both regions independently", async () => {
			await userEvent.click(await screen.findByRole("button", { name: "Simulate" }));
			await screen.findByRole("option", { name: "Prepare change · next" });
			await userEvent.click(screen.getByRole("button", { name: "Apply event" }));
			const api = await screen.findByRole("option", { name: "Implement API · next" });
			await userEvent.selectOptions(screen.getByRole("combobox", { name: "Outcome" }), api);
			await userEvent.click(screen.getByRole("button", { name: "Apply event" }));
			await screen.findByRole("option", { name: "Verify API · next" });
			await expect(screen.getByRole("option", { name: "Write docs · next" })).toBeInTheDocument();
			await expect(screen.queryByRole("combobox", { name: "Actor" })).not.toBeInTheDocument();
			await userEvent.selectOptions(screen.getByRole("combobox", { name: "Zoom" }), "workflow");
		});
		await context.step("Focus and return with sibling collapse retained", async () => {
			await userEvent.click(
				await screen.findByRole("button", { name: "Collapse Implementation / Docs" }),
			);
			await userEvent.click(
				await screen.findByRole("button", { name: "Focus Implementation / Api" }),
			);
			await screen.findByRole("button", { name: "Collapse Implementation / Api" });
			await expect(
				screen.queryByRole("button", { name: "Focus Implementation / Docs" }),
			).not.toBeInTheDocument();
			await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
			await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
			await userEvent.click(screen.getByRole("button", { name: /^Workflow$/u }));
			await userEvent.click(
				await screen.findByRole("button", { name: "Expand Implementation / Docs" }),
			);
			await screen.findByRole("button", { name: "Inspect Implementation / Docs / Write" });
		});
	},
} satisfies StoryObj<PreviewArgs>;

export const HierarchyStress = {
	name: "Hierarchy stress",
	render: () => <WorkflowHierarchyStress />,
	parameters: {
		docs: {
			codePanel: true,
			source: { code: hierarchySource, language: "typescript", type: "code" },
		},
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Focus Implementation / Api / Verification" }),
		);
		await userEvent.click(
			await screen.findByRole("button", {
				name: "Collapse Implementation / Api / Verification / Unit",
			}),
		);
		await screen.findByRole("button", {
			name: "Expand Implementation / Api / Verification / Unit",
		});
		await userEvent.click(screen.getByRole("button", { name: /^Workflow$/u }));
		await screen.findByRole("button", {
			name: "Expand Implementation / Api / Verification / Unit",
		});
	},
};
