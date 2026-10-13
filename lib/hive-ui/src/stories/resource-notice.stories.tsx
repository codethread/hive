import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResourceNotice } from "../ui.tsx";

const meta = {
	title: "Foundations/Resource notice",
	component: ResourceNotice,
	args: { label: "Hierarchy", resource: { kind: "loading", previous: null } },
} satisfies Meta<typeof ResourceNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Refreshing: Story = { args: { resource: { kind: "loading", previous: {} } } };
export const Unavailable: Story = {
	args: { resource: { kind: "failed", previous: null, message: "Fixture read failed." } },
};
export const RetainedSnapshot: Story = {
	args: { resource: { kind: "failed", previous: {}, message: "Refresh failed." } },
};
export const OutOfDate: Story = { args: { resource: { kind: "stale", data: {} } } };
