import {
	COLONY_ID,
	fixtureDetail,
	hierarchy,
	malformedMergeDetail,
	malformedMergeHierarchy,
	worker,
} from "./fixtures.ts";
import { HttpResponse, http } from "msw";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { previewHierarchy, previewSample, workflowDetail } from "./workflow-fixtures.ts";
import { Inspector } from "../inspector.tsx";
import { beadHandlers } from "./handlers.ts";
import { useSearch } from "@tanstack/react-router";
import { workflowHandlers } from "./workflow-simulation-fixture.ts";

const CENTER_FRACTION = 0.5;

const unavailableHierarchy = structuredClone(hierarchy);
for (const node of unavailableHierarchy.nodes) {
	node.beeAssignments = [];
	node.merges = [];
}

const meta = {
	title: "Beads/Bead inspector",
	component: SelectedInspector,
	subcomponents: { Inspector },
	render: () => <SelectedInspector />,
	parameters: { navigation: { bead: "hv-ui.1" } },
} satisfies Meta<typeof Inspector>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithFamily: Story = {};
export const MalformedMerge: Story = {
	parameters: { msw: beadHandlers(malformedMergeHierarchy, malformedMergeDetail) },
};
export const Standalone: Story = { parameters: { navigation: { bead: "hv-review" } } };
export const BeeContext: Story = {
	parameters: { navigation: { view: "open", request: worker.id, bead: "hv-ui.1" } },
};
export const WithWorkflows: Story = {
	// eslint-disable-next-line max-statements -- Verify nested modal clicks, simulation and restored focus together.
	play: async () => {
		const inspector = await screen.findByRole("dialog", { name: "Bead details" });
		const trigger = within(inspector).getByRole("tabpanel", { name: /^Bead$/u });
		const open = within(trigger).getByRole("button", {
			name: `View workflow for ${previewSample.card.id}`,
		});
		await userEvent.click(open);
		const workflow = await screen.findByRole("dialog", { name: "Workflow preview" });
		const simulate = await within(workflow).findByRole("button", { name: /^Simulate$/u });
		const bounds = simulate.getBoundingClientRect();
		await expect(
			document
				.elementFromPoint(
					bounds.x + bounds.width * CENTER_FRACTION,
					bounds.y + bounds.height * CENTER_FRACTION,
				)
				?.closest("button"),
		).toBe(simulate);
		await userEvent.click(simulate);
		await within(workflow).findByRole("combobox", { name: "Outcome" });
		await userEvent.click(within(workflow).getByRole("button", { name: /^Saved$/u }));
		await userEvent.click(within(workflow).getByRole("button", { name: "Close workflow preview" }));
		await expect(inspector).toBeVisible();
		await expect(open).toHaveFocus();
	},
	parameters: {
		navigation: { bead: previewSample.card.id },
		msw: [
			...beadHandlers(previewHierarchy, (id) => workflowDetail(id, previewHierarchy)),
			...workflowHandlers([previewSample]),
		],
	},
};
export const AssignmentDetailsUnavailable: Story = {
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/annotations", () =>
				HttpResponse.json({ message: "Details could not be read." }, { status: 503 }),
			),
			...beadHandlers(unavailableHierarchy, (id) => {
				const detail = fixtureDetail(id);
				return { ...detail, card: { ...detail.card, beeAssignments: [], merges: [] } };
			}),
		],
	},
};

function SelectedInspector() {
	const { bead } = useSearch({ from: "/colonies/$colonyId" });
	return bead === undefined ? null : <Inspector colonyId={COLONY_ID} id={bead} />;
}
