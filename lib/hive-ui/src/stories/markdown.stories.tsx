import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownContent } from "../markdown.tsx";
import { criteria } from "./fixtures.ts";

const mixedTable = [
	"| Bead | Description | Follow-up |",
	"| --- | --- | --- |",
	"| Status labels | Clarify the label shown while a worker is waiting. | Ready for review. |",
	"| Incident timeline | A delayed refresh left the incident timeline showing an earlier update. " +
		"The next refresh restored the current entries, but the selected row moved out of view. | " +
		"Confirm that selection stays visible when new entries arrive, then capture the result in the bead. |",
	"| Inspector layout | When an incident includes several related tasks, the bead description needs enough " +
		"detail to explain what happened without making every row difficult to scan. Keep the initial symptom, " +
		"the affected view and the observed recovery together so a reader can understand the sequence before " +
		"opening the linked evidence. Short status values should remain easy to find beside this longer account. | " +
		"Capture the same incident table at the regular preview width and in the narrow panel used during triage. " +
		"Compare where the prose wraps, whether the short labels remain readable and how far a reader must scroll " +
		"to reach the last column. Record any row that becomes difficult to follow so the next layout change can be " +
		"checked against a concrete example. |",
].join("\n");

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

export const ShortTable: Story = {
	args: {
		children: `| Bead | Status | Priority |
| --- | --- | --- |
| Cache refresh | Open | P2 |
| Timeline selection | In progress | P1 |
| Status labels | Closed | P3 |`,
	},
};

export const MixedProseTable: Story = { args: { children: mixedTable } };

export const LongTokensTable: Story = {
	args: {
		children: [
			"| Evidence | Reference | Status |",
			"| --- | --- | --- |",
			"| Incident report | <https://incidents.example.test/reports/2026-10-19/" +
				"inspector-table-wrapping-after-a-paused-worker-resumes-with-saved-progress> | Captured |",
			"| Snapshot key | " +
				"`incident_inspector_markdown_table_prose_wrapping_regression_snapshot_for_resumed_worker_delivery` | Ready |",
		].join("\n"),
	},
};

export const NarrowMixedProseTable: Story = {
	args: { children: mixedTable },
	render: (args) => (
		<div className="w-80 max-w-full">
			<MarkdownContent>{args.children}</MarkdownContent>
		</div>
	),
};
