import { COLONY_ID, board } from "./fixtures.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColumnSettings } from "../column-settings.tsx";

const meta = {
	title: "Workspace/Column settings",
	component: ColumnSettings,
	args: { colony: COLONY_ID, present: board.cards.map((card) => card.status), selected: [] },
	decorators: [
		(Story) => (
			<div className="p-5">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ColumnSettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NativeAndCustomStatuses: Story = {};
export const FilteredColumns: Story = {
	args: { present: ["blocked", "in_review"], selected: ["blocked", "in_review"] },
};
