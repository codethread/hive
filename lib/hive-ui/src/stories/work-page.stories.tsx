import { HttpResponse, delay, http } from "msw";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { board, hierarchy, worker } from "./fixtures.ts";
import { previewHierarchy, previewSample, workflowDetail } from "./workflow-fixtures.ts";
import { WorkPage } from "../work-page.tsx";
import { beadHandlers } from "./handlers.ts";
import { workflowHandlers } from "./workflow-simulation-fixture.ts";

const FETCH_DELAY_MS = 1500;

const meta = {
	title: "Workspace/Work board",
	component: WorkPage,
	parameters: { shell: true },
} satisfies Meta<typeof WorkPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Beads: Story = {};
export const Bees: Story = { parameters: { navigation: { view: "open" } } };
export const BeeGraph: Story = {
	parameters: {
		navigation: { view: "open", presentation: "graph", request: worker.id, ancestry: worker.id },
	},
};
export const BeadInspector: Story = {
	name: "Bead inspector with workflows",
	parameters: {
		navigation: { bead: previewSample.card.id },
		msw: [
			...beadHandlers(previewHierarchy, (id) => workflowDetail(id, previewHierarchy)),
			...workflowHandlers([previewSample]),
		],
	},
};

export const Paper: Story = { globals: { theme: "paper" } };

export const SlowRefresh: Story = {
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/board", async () => {
				await delay(FETCH_DELAY_MS);
				return HttpResponse.json(board);
			}),
			http.get("/api/colonies/:colony/hierarchy", async () => {
				await delay(FETCH_DELAY_MS);
				return HttpResponse.json(hierarchy);
			}),
		],
	},
};

export const StaleHierarchy: Story = {
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/hierarchy", () =>
				HttpResponse.json({ ...hierarchy, stale: true }),
			),
		],
	},
};

export const HierarchyFailure: Story = {
	parameters: {
		msw: [
			http.get("/api/colonies/:colony/hierarchy", async () => {
				await delay(FETCH_DELAY_MS);
				return HttpResponse.json({ message: "Hierarchy read failed." }, { status: 503 });
			}),
		],
	},
};
