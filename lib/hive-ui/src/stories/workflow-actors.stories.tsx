import {
	NestedActors as NestedActorsCase,
	NestedBeesHandoff as NestedBeesHandoffCase,
	NestedBeesStarting as NestedBeesStartingCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import type { Meta } from "@storybook/react-vite";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Nested actors",
} satisfies Meta<PreviewArgs>;
export default meta;

export const NestedActors = { ...NestedActorsCase, name: "Nested Actors" };
export const NestedBeesStarting = { ...NestedBeesStartingCase, name: "Nested Bees Starting" };
export const NestedBeesHandoff = { ...NestedBeesHandoffCase, name: "Nested Bees Handoff" };
