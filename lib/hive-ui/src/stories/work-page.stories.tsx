import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkPage } from "../work-page.tsx";
import { worker } from "./fixtures.ts";

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
