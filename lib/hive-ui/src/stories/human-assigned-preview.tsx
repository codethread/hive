import { COLONY_ID, board, hierarchy } from "./fixtures.ts";
import type { Card, Hierarchy } from "../../contracts.ts";
import { BeadBoard } from "../bead-board.tsx";
import { BeadOutline } from "../bead-outline.tsx";
import { useSearch } from "@tanstack/react-router";

const additionalChildren = [
	ownedCard("hv-ui.5", "Polish board keyboard navigation", "open", "ct", null),
	ownedCard("hv-ui.6", "Confirm hierarchy source data", "blocked", "ct", "amber-quiet-otter"),
];
const assignments: Card[] = [
	ownedCard("hv-decide", "Choose the board layout", "in_progress", "ct", "ct"),
	ownedCard("hv-review-design", "Review the human swimlane design", "open", "ct", "ct"),
	ownedCard("hv-signoff", "Sign off the keyboard interaction", "in_review", "alex", "alex"),
	...board.cards
		.filter(
			(card) =>
				card.id.startsWith("hv-ui") || card.id.startsWith("hv-rails") || card.id === "hv-review",
		)
		// eslint-disable-next-line oxc/no-map-spread -- Preserve the shared workshop fixtures.
		.map((card) => ({
			...card,
			owner: "ct",
			assignee: card.id === "hv-ui.3" ? "ct" : card.assignee,
		})),
	...additionalChildren,
];
const assignmentsById = new Map(assignments.map((card) => [card.id, card]));
export const humanPreviewHierarchy: Hierarchy = {
	...hierarchy,
	nodes: [
		// eslint-disable-next-line oxc/no-map-spread -- Preserve full native context for outline navigation.
		...hierarchy.nodes.map((node) => ({ ...node, ...assignmentsById.get(node.id) })),
		// eslint-disable-next-line oxc/no-map-spread -- Add native parents without mutating card fixtures.
		...additionalChildren.map((card) => ({ ...card, parentIds: ["hv-ui"] })),
	],
};

export function HumanAssignedPreview() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	if (search.outline !== undefined) {
		return <BeadOutline colonyId={COLONY_ID} id={search.outline} />;
	}
	return (
		<div className="overflow-auto [&_.workflow-trigger]:hidden">
			<div className="flex items-center justify-between gap-4 px-5 py-5">
				<div>
					<h2 className="text-sm font-medium">Work assigned to people, first</h2>
					<p className="mt-1 text-xs text-muted">
						Open a child&apos;s outline to see its parent and siblings.
					</p>
				</div>
				<span className="bead-label">Human assignments and families</span>
			</div>
			<BeadBoard board={{ ...board, cards: assignments }} hierarchy={humanPreviewHierarchy} />
		</div>
	);
}

// eslint-disable-next-line max-params -- Keep native assignment comparisons visible in fixture rows.
function ownedCard(
	id: string,
	title: string,
	status: string,
	owner: string | null,
	assignee: string | null,
): Card {
	return {
		id,
		title,
		status,
		owner,
		assignee,
		beeAssignments: [],
		merges: [],
		issueType: "task",
		isWorkflowGenerated: false,
		priority: 2,
		labels: ["ui"],
		updatedAt: board.fetchedAt,
	};
}
