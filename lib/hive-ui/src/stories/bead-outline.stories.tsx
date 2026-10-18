import type { Meta, StoryObj } from "@storybook/react-vite";
import { nestedWorkflows, workflowDetail } from "./workflow-fixtures.ts";
import { BeadOutline } from "../bead-outline.tsx";
import { COLONY_ID } from "./fixtures.ts";
import { beadHandlers } from "./handlers.ts";
import { preferences } from "../data.ts";

const meta = {
	title: "Beads/Bead outline",
	component: BeadOutline,
	decorators: [
		(Story) => (
			<div className="[&_.workflow-trigger]:hidden">
				<Story />
			</div>
		),
	],
	args: { colonyId: COLONY_ID, id: "hv-ui" },
	parameters: {
		controls: { disable: true },
		navigation: { outline: "hv-ui" },
	},
} satisfies Meta<typeof BeadOutline>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ActiveDescendants: Story = {};
export const WithWorkflows: Story = {
	args: { id: "hv-release.4" },
	parameters: {
		navigation: { outline: "hv-release.4" },
		msw: beadHandlers(nestedWorkflows, workflowDetail),
	},
};
export const Leaf: Story = {
	args: { id: "hv-ui.1" },
	parameters: { navigation: { outline: "hv-ui.1" } },
};
export const IncludeClosed: Story = {
	beforeEach() {
		preferences.setState({ outlineClosed: true });
	},
};
