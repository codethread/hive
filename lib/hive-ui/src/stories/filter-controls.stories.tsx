import {
	ActiveFilters,
	FilterableLabel,
	LabelFilters,
	PriorityFilters,
	StatusFilters,
} from "../filter-controls.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { board } from "./fixtures.ts";

const meta = {
	title: "Workspace/Filter controls",
	render: FilterControls,
	parameters: {
		navigation: {
			statuses: ["blocked"],
			priorities: [0],
			all: ["ui"],
			any: ["hitl"],
			exclude: ["review"],
		},
	},
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const StatusPriorityAndLabels: Story = {};
export const NoRules: Story = {
	parameters: { navigation: { statuses: [], priorities: [], all: [], any: [], exclude: [] } },
};

function FilterControls() {
	return (
		<div className="space-y-5 p-5">
			<ActiveFilters />
			<div className="max-w-sm space-y-5">
				<StatusFilters />
				<PriorityFilters />
				<LabelFilters labels={board.labels} />
				<p className="text-sm text-muted">Click or right-click a label to choose a filter group:</p>
				<FilterableLabel label="graph" />
			</div>
		</div>
	);
}
