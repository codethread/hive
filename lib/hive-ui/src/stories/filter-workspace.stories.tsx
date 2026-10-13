import type { Meta, StoryObj } from "@storybook/react-vite";
import { board, hierarchy } from "./fixtures.ts";
import { BeadBoard } from "../bead-board.tsx";
import { FilterWorkspace } from "../filter-drawer.tsx";
import { preferences } from "../data.ts";

const meta = {
	title: "Workspace/Filter workspace",
	component: FilterWorkspace,
	args: { board, children: <BeadBoard board={board} hierarchy={hierarchy} /> },
	render: (args) => (
		<main className="work-page">
			<FilterWorkspace board={args.board}>{args.children}</FilterWorkspace>
		</main>
	),
} satisfies Meta<typeof FilterWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ViewsAndFilters: Story = {};
export const Collapsed: Story = {
	beforeEach() {
		preferences.setState({ sidebarCollapsed: true });
	},
};
export const ActiveRules: Story = {
	parameters: {
		navigation: {
			statuses: ["blocked"],
			priorities: [0],
			all: ["ui"],
			any: ["hitl"],
			exclude: ["review"],
		},
	},
};
