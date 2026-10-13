import type { Meta, StoryObj } from "@storybook/react-vite";
import { board, hierarchy } from "./fixtures.ts";
import { BeadBoard } from "../bead-board.tsx";

const meta = {
	title: "Beads/Bead board",
	component: BeadBoard,
	args: { board, hierarchy },
} satisfies Meta<typeof BeadBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FamiliesAndColumns: Story = {};
export const WithoutHierarchy: Story = { args: { hierarchy: null } };
export const Empty: Story = { args: { board: { ...board, cards: [] } } };
export const Paper: Story = { globals: { theme: "paper" } };
