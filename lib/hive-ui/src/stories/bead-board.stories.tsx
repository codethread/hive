import type { Meta, StoryObj } from "@storybook/react-vite";
import { board, hierarchy } from "./fixtures.ts";
import {
	multipleWorkflows,
	nestedWorkflows,
	singleWorkflow,
	workflowHierarchy,
} from "./workflow-fixtures.ts";
import { BeadBoard } from "../bead-board.tsx";
import { preferences } from "../data.ts";

const meta = {
	title: "Beads/Bead board",
	component: BeadBoard,
	decorators: [
		(Story) => (
			<div className="[&_.workflow-trigger]:hidden">
				<Story />
			</div>
		),
	],
	args: { board, hierarchy },
	beforeEach() {
		preferences.setState({ showWorkflowBeads: true });
	},
} satisfies Meta<typeof BeadBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FamiliesAndColumns: Story = {};
export const SingleWorkflow: Story = {
	args: { board: { ...board, cards: singleWorkflow.nodes }, hierarchy: singleWorkflow },
};
export const MultipleWorkflows: Story = {
	args: { board: { ...board, cards: multipleWorkflows.nodes }, hierarchy: multipleWorkflows },
};
export const NestedWorkflows: Story = {
	args: { board: { ...board, cards: nestedWorkflows.nodes }, hierarchy: nestedWorkflows },
};
export const WorkflowFamilies: Story = {
	args: { board: { ...board, cards: workflowHierarchy.nodes }, hierarchy: workflowHierarchy },
};
export const WithoutHierarchy: Story = { args: { hierarchy: null } };
export const Empty: Story = { args: { board: { ...board, cards: [] } } };
export const Paper: Story = { globals: { theme: "paper" } };
