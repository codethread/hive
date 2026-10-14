import { BeeLogTimeline, BeeLogs } from "../bee-logs.tsx";
import { COLONY_ID, worker } from "./fixtures.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
	title: "Bees/Bee log timeline",
	component: BeeLogTimeline,
	render: ({ colonyId, requestId }) => <BeeLogs colonyId={colonyId} requestId={requestId} />,
	args: { colonyId: COLONY_ID, requestId: worker.id, attempt: "attempt-current" },
	parameters: {
		controls: { disable: true },
		navigation: { view: "open", request: worker.id },
		docs: {
			description: {
				component:
					"Open full timeline for production dialog, paging, raw details, attempts and stderr. " +
					"All reads use MSW fixtures.",
			},
		},
	},
} satisfies Meta<typeof BeeLogTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PagedHistory: Story = {};
export const Paper: Story = { globals: { theme: "paper" } };
