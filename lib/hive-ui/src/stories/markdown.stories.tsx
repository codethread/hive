import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownContent } from "../markdown.tsx";
import { criteria } from "./fixtures.ts";

const meta = {
	title: "Foundations/Markdown content",
	component: MarkdownContent,
	args: { children: criteria },
	decorators: [
		(Story) => (
			<div className="max-w-3xl p-6">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof MarkdownContent>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AcceptanceCriteria: Story = {};
export const Empty: Story = { args: { children: "" } };
