import { BeeHistory, BoardTabs } from "../board-navigation.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = { title: "Workspace/Board navigation", render: Navigation } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Beads: Story = {};
export const OpenBees: Story = { parameters: { navigation: { view: "open" } } };
export const CompletedBees: Story = { parameters: { navigation: { view: "completed" } } };

function Navigation() {
	return (
		<div className="flex flex-wrap items-center gap-5 p-5">
			<BoardTabs />
			<BeeHistory />
		</div>
	);
}
