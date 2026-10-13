import type { Meta, StoryObj } from "@storybook/react-vite";
import { BeadOutline } from "../bead-outline.tsx";
import { COLONY_ID } from "./fixtures.ts";
import { preferences } from "../data.ts";

const meta = {
	title: "Beads/Bead outline",
	component: BeadOutline,
	args: { colonyId: COLONY_ID, id: "hv-ui" },
	parameters: {
		controls: { disable: true },
		navigation: { outline: "hv-ui" },
	},
} satisfies Meta<typeof BeadOutline>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ActiveDescendants: Story = {};
export const Leaf: Story = {
	args: { id: "hv-ui.1" },
	parameters: { navigation: { outline: "hv-ui.1" } },
};
export const IncludeClosed: Story = {
	beforeEach() {
		preferences.setState({ outlineClosed: true });
	},
};
