import type { Meta, StoryObj } from "@storybook/react-vite";
import { BranchExplorer } from "../branch-explorer.tsx";
import { fixtureFamily } from "./fixtures.ts";
import { fn } from "storybook/test";
import { nestedWorkflows } from "./workflow-fixtures.ts";
import { preferences } from "../data.ts";

const meta = {
	title: "Beads/Branch explorer",
	component: BranchExplorer,
	args: { hierarchy: fixtureFamily("hv-ui"), selected: "hv-ui.1", onSelect: fn<() => void>() },
	decorators: [
		(Story) => (
			<div className="max-w-md p-4 [&_.workflow-trigger]:hidden">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BranchExplorer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NativeFamily: Story = {};
export const WithWorkflows: Story = {
	args: { hierarchy: nestedWorkflows, selected: "hv-release.4.1.1" },
};
export const IncludeClosed: Story = {
	beforeEach() {
		preferences.setState({ outlineClosed: true });
	},
};
