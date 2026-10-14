import { COLONY_ID, worker } from "./fixtures.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BeeLogs } from "../bee-logs.tsx";

const meta = {
	title: "Bees/Bee log preview",
	component: BeeLogs,
	args: { colonyId: COLONY_ID, requestId: worker.id },
	parameters: { navigation: { view: "open", request: worker.id }, controls: { disable: true } },
} satisfies Meta<typeof BeeLogs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LastFive: Story = {};
export const Paper: Story = { globals: { theme: "paper" } };
export const MissingFile: Story = {
	args: { requestId: "fixture-missing" },
	parameters: { navigation: { view: "open", request: "fixture-missing" } },
};
export const NoLaunch: Story = {
	args: { requestId: "fixture-no-launch" },
	parameters: { navigation: { view: "open", request: "fixture-no-launch" } },
};
export const Empty: Story = {
	args: { requestId: "fixture-empty" },
	parameters: { navigation: { view: "open", request: "fixture-empty" } },
};
export const IncompleteFinalLine: Story = {
	args: { requestId: "fixture-incomplete" },
	parameters: { navigation: { view: "open", request: "fixture-incomplete" } },
};
export const InspectionUnavailable: Story = {
	args: { requestId: "fixture-unavailable" },
	parameters: { navigation: { view: "open", request: "fixture-unavailable" } },
};
