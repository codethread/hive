import type { Meta, StoryObj } from "@storybook/react-vite";
import { malformedMergeDetail, malformedMergeHierarchy, worker } from "./fixtures.ts";
import {
	multipleWorkflows,
	nestedWorkflows,
	singleWorkflow,
	workflowDetail,
	workflowHierarchy,
} from "./workflow-fixtures.ts";
import { WorkPage } from "../work-page.tsx";
import { beadHandlers } from "./handlers.ts";

const meta = {
	title: "Workspace/Work board",
	component: WorkPage,
	parameters: { shell: true },
} satisfies Meta<typeof WorkPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Beads: Story = {};
export const Bees: Story = { parameters: { navigation: { view: "open" } } };
export const BeeGraph: Story = {
	parameters: {
		navigation: { view: "open", presentation: "graph", request: worker.id, ancestry: worker.id },
	},
};
export const CompletedBees: Story = { parameters: { navigation: { view: "completed" } } };
export const Inspector: Story = { parameters: { navigation: { bead: "hv-ui.1" } } };
export const DescendantOutline: Story = { parameters: { navigation: { outline: "hv-ui" } } };
export const Filtered: Story = {
	parameters: { navigation: { statuses: ["blocked"], all: ["hitl"] } },
};
export const Empty: Story = { parameters: { navigation: { query: "no-such-bead" } } };
export const Paper: Story = { globals: { theme: "paper" } };
export const SingleWorkflow: Story = {
	parameters: { msw: beadHandlers(singleWorkflow, workflowDetail) },
};
export const MultipleWorkflows: Story = {
	parameters: { msw: beadHandlers(multipleWorkflows, workflowDetail) },
};
export const NestedWorkflows: Story = {
	parameters: { msw: beadHandlers(nestedWorkflows, workflowDetail) },
};
export const WorkflowFamilies: Story = {
	parameters: { msw: beadHandlers(workflowHierarchy, workflowDetail) },
};
export const WorkflowInspector: Story = {
	...NestedWorkflows,
	parameters: { ...NestedWorkflows.parameters, navigation: { bead: "hv-release.4.1.1" } },
};
export const WorkflowOutline: Story = {
	...NestedWorkflows,
	parameters: { ...NestedWorkflows.parameters, navigation: { outline: "hv-release.4" } },
};
export const WorkflowPaper: Story = { ...WorkflowFamilies, globals: { theme: "paper" } };

export const MalformedMerge: Story = {
	parameters: { msw: beadHandlers(malformedMergeHierarchy, malformedMergeDetail) },
};
