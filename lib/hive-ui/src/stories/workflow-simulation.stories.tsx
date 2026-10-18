import {
	InitialOrigin as InitialOriginCase,
	NestedBeeChildSimulation as NestedBeeChildSimulationCase,
	NestedBeesUnsupported as NestedBeesUnsupportedCase,
	Simulation as SimulationCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import type { Meta } from "@storybook/react-vite";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Simulation",
} satisfies Meta<PreviewArgs>;
export default meta;

export const Simulation = { ...SimulationCase, name: "Simulation" };
export const InitialOrigin = { ...InitialOriginCase, name: "Initial input after saved failure" };
export const NestedBeesUnsupported = {
	...NestedBeesUnsupportedCase,
	name: "Nested Bees Unsupported",
};
export const NestedBeeChildSimulation = {
	...NestedBeeChildSimulationCase,
	name: "Nested Bee Child Simulation",
};
