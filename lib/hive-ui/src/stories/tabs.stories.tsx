import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs.tsx";

const meta = { title: "Foundations/Tabs", component: Tabs, render: TabExample } satisfies Meta<
	typeof Tabs
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InspectorPanes: Story = {};

function TabExample() {
	return (
		<div className="p-5">
			<Tabs defaultValue="bead">
				<TabsList aria-label="Inspector views">
					<TabsTrigger value="bead">Bead</TabsTrigger>
					<TabsTrigger value="outline">Outline</TabsTrigger>
					<TabsTrigger value="unavailable" disabled>
						Unavailable
					</TabsTrigger>
				</TabsList>
				<TabsContent value="bead" className="p-4">
					Selected bead details
				</TabsContent>
				<TabsContent value="outline" className="p-4">
					Native family outline
				</TabsContent>
			</Tabs>
		</div>
	);
}
