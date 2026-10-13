import { BeeAssignment, Label } from "../ui.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { cards } from "./fixtures.ts";

const meta = { title: "Foundations/Bead metadata", render: BeadMetadata } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const LabelsAndAssignment: Story = {};

function BeadMetadata() {
	return (
		<div className="flex flex-wrap items-center gap-2 p-5">
			<Label>in_progress</Label>
			<Label>P1</Label>
			<Label>ui</Label>
			<BeeAssignment card={cards[1]!} />
			<span className="text-xs text-muted">{cards[1]!.assignee}</span>
		</div>
	);
}
