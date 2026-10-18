import { Modal as ActiveRun, workflowPreviewMeta } from "./workflow-preview-cases.tsx";
import type { Meta } from "@storybook/react-vite";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";

const meta = {
	...workflowPreviewMeta,
	title: "Beads/Workflow preview",
} satisfies Meta<PreviewArgs>;
export default meta;

export const Modal = { ...ActiveRun, name: "Active run" };
