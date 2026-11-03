import type { Meta, StoryObj } from "@storybook/react-vite";
import { ancestry, bees, outcomeBees, parentBee, reviewer, worker } from "./fixtures.ts";
import { BeeGraph } from "../bee-graph.tsx";
import type { GraphProps } from "../graph-loader.ts";
import { beeScene } from "../bee-scene.ts";
import { fn } from "storybook/test";
import { preferences } from "../data.ts";
import { useState } from "react";
import { useStore } from "zustand";

const meta = {
	title: "Bees/Bee graph",
	component: BeeGraph,
	render(args) {
		const handleSelect = args.onSelect;
		return (
			<InteractiveGraph
				key={args.selected}
				scene={args.scene}
				selected={args.selected}
				onSelect={handleSelect}
				theme={args.theme}
			/>
		);
	},
	args: {
		scene: beeScene({ bees, inferred: [] }, "", null),
		selected: undefined,
		onSelect: fn<(id: string) => void>(),
		theme: "moss",
	},
	argTypes: {
		theme: { table: { disable: true } },
		onSelect: { table: { disable: true } },
		scene: { control: false },
	},
	parameters: {
		docs: {
			description: {
				component:
					"Bee graph: automatically arranged request cards. Solid edges show " +
					"recorded requester attribution; dashed edges show inferred parent links. " +
					"Nested Requests connects loaded requests automatically; Inferred Ancestry " +
					"adds context beyond the page. Click a card to select it; pan, zoom and Fit " +
					"use the real React Flow viewport.",
			},
		},
	},
} satisfies Meta<typeof BeeGraph>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RecordedRequesters: Story = {};
export const NestedRequests: Story = {
	args: {
		scene: beeScene(
			{
				bees: [parentBee, worker, { ...reviewer, requester: worker.identity }],
				inferred: [
					{ parent: parentBee.id, child: worker.id },
					{ parent: worker.id, child: reviewer.id },
				],
			},
			"",
			null,
		),
	},
};
export const InferredAncestry: Story = {
	args: { scene: beeScene({ bees, inferred: [] }, "", ancestry), selected: worker.id },
};
export const HistoricalContext: Story = {
	args: { scene: beeScene({ bees, inferred: [] }, "amber", ancestry), selected: worker.id },
};
export const Outcomes: Story = {
	args: { scene: beeScene({ bees: outcomeBees, inferred: [] }, "", null) },
};
export const NoMatches: Story = {
	args: { scene: beeScene({ bees, inferred: [] }, "no-such-bee", null) },
};
export const Paper: Story = {
	globals: { theme: "paper" },
	args: { scene: beeScene({ bees, inferred: [] }, "", ancestry), selected: worker.id },
};
export const LongIdentity: Story = {
	args: {
		scene: beeScene(
			{
				bees: [
					{
						...worker,
						identity: "amber-quiet-otter-with-an-unusually-long-friendly-name",
						taskIds: [],
					},
				],
				inferred: [],
			},
			"",
			null,
		),
	},
};

function InteractiveGraph(args: GraphProps) {
	const [selected, setSelected] = useState(args.selected);
	const theme = useStore(preferences, (state) => state.theme);
	return (
		<>
			<BeeGraph
				scene={args.scene}
				selected={selected}
				onSelect={(id) => {
					setSelected(id);
					args.onSelect(id);
				}}
				theme={theme}
			/>
			<output className="block border-t border-line p-4 text-xs text-muted" aria-live="polite">
				Selected request: {selected ?? "none"}
			</output>
		</>
	);
}
