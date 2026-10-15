/* eslint-disable no-magic-numbers -- Choose deliberately varied fixture cards. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BeadCard } from "../bead-card.tsx";
import { cards } from "./fixtures.ts";

const meta = {
	title: "Beads/Bead card",
	component: BeadCard,
	args: { card: cards[1]! },
	decorators: [
		(Story) => (
			<div className="max-w-sm p-5">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BeadCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AssignedBee: Story = {};
export const Compact: Story = { args: { compact: true } };
export const Blocked: Story = { args: { card: cards[3]! } };
export const Unassigned: Story = { args: { card: cards[2]! } };
export const Selected: Story = { parameters: { navigation: { bead: cards[1]!.id } } };
export const LongTitle: Story = {
	args: {
		card: {
			...cards[0]!,
			title:
				"Arrange a large provenance graph with recorded requester " +
				"attribution, inferred parents and historical context across many " +
				"linked task beads",
		},
	},
};

export const LinkedMerge: Story = {};
export const MultipleMerges: Story = {
	args: {
		card: {
			...cards[1]!,
			merges: [
				...cards[1]!.merges,
				{
					kind: "valid",
					id: "hv-merge-44",
					title: "Refine graph layout",
					url: "https://gitlab.com/example/hive/-/merge_requests/44",
					branch: "feat/graph-layout",
					resolution: "merged",
				},
				{
					kind: "valid",
					id: "hv-merge-45",
					title: "Explore an alternative layout",
					url: "https://github.com/example/hive/pull/45",
					branch: "experiment/graph-layout",
					resolution: "abandoned",
				},
			],
		},
	},
};

export const MalformedMerge: Story = {
	args: {
		card: {
			...cards[1]!,
			merges: [
				{
					kind: "invalid",
					id: "hv-merge-malformed",
					title: "Arrange bee provenance graph",
					problem: "Description is not valid JSON.",
				},
			],
		},
	},
};
