import {
	Completed as CompletedCase,
	Unavailable as UnavailableCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import type { Meta } from "@storybook/react-vite";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Inspection",
} satisfies Meta<PreviewArgs>;
export default meta;

export const Completed = { ...CompletedCase, name: "Completed run" };
export const Unavailable = { ...UnavailableCase, name: "Unavailable" };
