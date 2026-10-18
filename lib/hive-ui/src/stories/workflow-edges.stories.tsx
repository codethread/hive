import type { Meta } from "@storybook/react-vite";
import { WorkflowEdgePath } from "../workflow-canvas.tsx";
import { WorkflowEdgeVariants } from "./workflow-explorer.tsx";

const meta = {
	title: "Workflow preview/Edges",
	component: WorkflowEdgePath,
	parameters: { controls: { disable: true } },
} satisfies Meta<typeof WorkflowEdgePath>;
export default meta;

export const EdgeStates = {
	name: "Edge states",
	render: () => <WorkflowEdgeVariants />,
};
