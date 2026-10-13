import { BeeSearch, HeaderSearch } from "../board-search.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = { title: "Workspace/Board search", render: SearchControls } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const BeadAndRequestSearch: Story = {};
export const WithQueries: Story = {
	parameters: { navigation: { query: "graph", beeQuery: "amber" } },
};

function SearchControls() {
	return (
		<div className="max-w-3xl space-y-5 p-5">
			<HeaderSearch />
			<BeeSearch />
		</div>
	);
}
