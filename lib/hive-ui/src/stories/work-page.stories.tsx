import type { Meta, StoryObj } from "@storybook/react-vite";
import { previewHierarchy, previewSample, workflowDetail } from "./workflow-fixtures.ts";
import { WorkPage } from "../work-page.tsx";
import { beadHandlers } from "./handlers.ts";
import { worker } from "./fixtures.ts";
import { workflowHandlers } from "./workflow-simulation-fixture.ts";

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
export const BeadInspector: Story = {
	name: "Bead inspector with workflows",
	parameters: {
		navigation: { bead: previewSample.card.id },
		msw: [
			...beadHandlers(previewHierarchy, (id) => workflowDetail(id, previewHierarchy)),
			...workflowHandlers([previewSample]),
		],
	},
};

export const Paper: Story = { globals: { theme: "paper" } };
