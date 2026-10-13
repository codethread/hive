import { COLONY_ID, board, hierarchy, worker } from "./fixtures.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BeadBoard } from "../bead-board.tsx";
import { Inspector } from "../inspector.tsx";
import { useSearch } from "@tanstack/react-router";

const meta = {
	title: "Beads/Bead inspector",
	component: InspectorOverBoard,
	subcomponents: { Inspector },
	render: InspectorOverBoard,
	parameters: { navigation: { bead: "hv-ui.1" } },
} satisfies Meta<typeof Inspector>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithFamily: Story = {};
export const Standalone: Story = { parameters: { navigation: { bead: "hv-review" } } };
export const BeeContext: Story = {
	parameters: { navigation: { view: "open", request: worker.id, bead: "hv-ui.1" } },
};

function InspectorOverBoard() {
	const { bead } = useSearch({ from: "/colonies/$colonyId" });
	return (
		<>
			<BeadBoard board={board} hierarchy={hierarchy} />
			{bead !== undefined && <Inspector colonyId={COLONY_ID} id={bead} />}
		</>
	);
}
