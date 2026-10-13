import type { Meta, StoryObj } from "@storybook/react-vite";
import { BranchExplorer } from "../branch-explorer.tsx";
import { fixtureFamily } from "./fixtures.ts";
import { fn } from "storybook/test";
import { preferences } from "../data.ts";

const meta = {
	title: "Beads/Branch explorer",
	component: BranchExplorer,
	args: { hierarchy: fixtureFamily("hv-ui"), selected: "hv-ui.1", onSelect: fn<() => void>() },
	decorators: [
		(Story) => (
			<div className="max-w-md p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BranchExplorer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NativeFamily: Story = {};
export const IncludeClosed: Story = {
	beforeEach() {
		preferences.setState({ outlineClosed: true });
	},
};
