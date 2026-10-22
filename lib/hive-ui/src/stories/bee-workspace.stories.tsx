import { COLONY_ID, OBSERVED_AT, bees, board, worker } from "./fixtures.ts";
import { EMPTY, boards, inventories, snapshot } from "../data.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { boardFilterSchema, boardKey, inventoryKey } from "../../contracts.ts";
import { BeeWorkspace } from "../bee-workspace.tsx";
import { useSearch } from "@tanstack/react-router";
import { useStore } from "zustand";

const meta = {
	title: "Bees/Bee workspace",
	component: BeeWorkspace,
	render: LoadedWorkspace,
	args: {
		colonyId: COLONY_ID,
		inventory: {
			kind: "loaded",
			bees,
			requestParents: [],
			total: bees.length,
			hasMore: false,
			readAt: OBSERVED_AT,
		},
		board,
	},
	parameters: {
		controls: { disable: true },
		navigation: { view: "open" },
		docs: {
			description: {
				component:
					"Bee workspace: shared request selection, Outline/Graph presentation, " +
					"local request search, selected work and explicit ancestry loading. " +
					"All reads use fixture responses.",
			},
		},
	},
} satisfies Meta<typeof BeeWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {};
export const Graph: Story = {
	parameters: { navigation: { view: "open", presentation: "graph", request: worker.id } },
};
export const LoadedAncestry: Story = {
	parameters: {
		navigation: { view: "open", presentation: "graph", request: worker.id, ancestry: worker.id },
	},
};
export const NoMatches: Story = {
	parameters: { navigation: { view: "open", beeQuery: "no-such-bee" } },
};
export const Completed: Story = { parameters: { navigation: { view: "completed" } } };

function LoadedWorkspace() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const inventory = useStore(inventories.store, (state) =>
		snapshot(state.entries[inventoryKey(COLONY_ID, search)] ?? EMPTY),
	);
	const snapshotBoard = useStore(boards.store, (state) =>
		snapshot(state.entries[boardKey(COLONY_ID, boardFilterSchema.parse(search))] ?? EMPTY),
	);
	return inventory?.kind === "loaded" ? (
		<BeeWorkspace colonyId={COLONY_ID} inventory={inventory} board={snapshotBoard} />
	) : (
		<output>Loading inventory…</output>
	);
}
