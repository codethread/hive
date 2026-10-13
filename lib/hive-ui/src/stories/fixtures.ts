/* eslint-disable no-magic-numbers -- Fixtures deliberately span native priorities and states. */
import type { Bee, Board, Card, Detail, Hierarchy, Provenance } from "../../contracts.ts";
import { DEFAULT_BEAD_STATUSES } from "../../contracts.ts";

export const COLONY_ID = "storybook";
export const OBSERVED_AT = "2026-10-08T14:30:00Z";
export const colony = {
	id: COLONY_ID,
	name: "Storybook fixtures",
	root: "/fixtures/hive",
	beadsDb: "/fixtures/beads.db",
	statuses: [...DEFAULT_BEAD_STATUSES, "in_review"],
};

export const worker: Bee = {
	id: "hv-request-worker",
	identity: "amber-quiet-otter",
	kind: "worker",
	harness: "codex",
	model: "fixture-model",
	requester: "green-calm-heron",
	status: "open",
	outcome: "pending",
	closedAt: null,
	observation: { at: OBSERVED_AT, author: "colony", text: "Implementation is in progress." },
	taskIds: ["hv-ui.1", "hv-ui.2"],
};
export const parentBee: Bee = {
	...worker,
	id: "hv-request-parent",
	identity: "green-calm-heron",
	kind: "slow-worker",
	requester: "ct",
	status: "closed",
	outcome: "succeeded",
	closedAt: OBSERVED_AT,
	taskIds: ["hv-ui"],
};
export const reviewer: Bee = {
	...worker,
	id: "hv-request-reviewer",
	identity: "silver-wise-fox",
	kind: "reviewer",
	requester: "ct",
	observation: null,
	taskIds: ["hv-review"],
};
export const bees: Bee[] = [worker, reviewer];
export const completedBees: Bee[] = [parentBee];
export const outcomeBees: Bee[] = [
	worker,
	parentBee,
	{ ...reviewer, status: "closed", outcome: "failed", closedAt: OBSERVED_AT },
	{
		...worker,
		id: "hv-request-cancelled",
		identity: "blue-soft-moth",
		status: "closed",
		outcome: "cancelled",
		requester: null,
		closedAt: OBSERVED_AT,
		taskIds: [],
	},
];
export const ancestry: Provenance = {
	chain: [worker, parentBee],
	end: { kind: "unmatched", requester: "ct" },
	fetchedAt: OBSERVED_AT,
};
export const cards: Card[] = [
	card("hv-ui", "Build the Hive UI", "in_progress", { assignee: "green-calm-heron", priority: 1 }),
	card("hv-ui.1", "Arrange bee provenance graph", "in_progress", {
		assignee: worker.identity,
		beeAssignments: [{ id: worker.id, kind: worker.kind }],
		priority: 1,
	}),
	card("hv-ui.2", "Inspect linked work and acceptance criteria", "open"),
	card("hv-ui.3", "Resolve label filter interaction", "blocked", {
		labels: ["ui", "hitl"],
		priority: 0,
	}),
	card("hv-ui.4", "Capture the visual reference", "closed"),
	card("hv-rails", "Polish the outline", "open"),
	card("hv-rails.1", "Add compact child spacing", "open"),
	card("hv-rails.2", "Refine hierarchy rails", "open"),
	card("hv-review", "Review the component workshop", "in_review", {
		assignee: reviewer.identity,
		labels: ["ui", "review"],
	}),
	card("hv-backlog", "Explore colony comparison", "open", { priority: 4, labels: [] }),
];
export const hierarchy: Hierarchy = {
	fetchedAt: OBSERVED_AT,
	nodes: cards.map((entry) => ({
		...entry,
		parentIds: entry.id.includes(".") ? [entry.id.split(".")[0]!] : [],
	})),
};
export const board: Board = {
	cards: cards.filter((entry) => entry.status !== "closed"),
	fetchedAt: OBSERVED_AT,
	hasMore: false,
	labels: ["ui", "graph", "hitl", "review"],
	query: ["br", "list", "--exclude-label", "system", "--json"],
};
export const criteria =
	"## Review the bee graph\n\n- [x] Recorded requester edges stay solid\n- " +
	"[ ] Inferred parent edges stay dashed\n- [ ] Selection works with " +
	"keyboard and pointer\n\n| Evidence | Meaning |\n| --- | --- |\n| Match | " +
	"Request on the loaded page |\n| Context | Explicitly loaded ancestry " +
	"|\n\nSee the `BeeGraph` story for both palettes.";

export function fixtureDetail(id: string): Detail {
	const selected = cards.find((entry) => entry.id === id)!;
	const dependencies =
		id === "hv-ui.1"
			? [
					{
						dependencyType: "blocks",
						id: "hv-ui.2",
						title: cards[2]!.title,
						priority: 2,
						status: "open",
					},
				]
			: [];
	const dependents =
		id === "hv-ui.2"
			? [
					{
						dependencyType: "blocks",
						id: "hv-ui.1",
						title: cards[1]!.title,
						priority: 1,
						status: "in_progress",
					},
				]
			: [];
	return {
		card: { ...selected, bees: bees.filter((bee) => bee.taskIds.includes(id)) },
		description:
			"Make the provenance graph easy to read without confusing historical observations with current process health.",
		acceptanceCriteria: criteria,
		comments: [
			{
				id: 1,
				at: OBSERVED_AT,
				author: "ct",
				text: "Keep native assignment distinct from requested work.",
			},
		],
		dependencies: { items: dependencies, total: dependencies.length },
		dependents: { items: dependents, total: dependents.length },
		fetchedAt: OBSERVED_AT,
	};
}

export function fixtureFamily(id: string): Hierarchy {
	const root = id.split(".")[0]!;
	return {
		...hierarchy,
		nodes: hierarchy.nodes.filter((entry) => entry.id === root || entry.parentIds.includes(root)),
	};
}

export function fixtureOutline(id: string): Hierarchy {
	return {
		...hierarchy,
		nodes: hierarchy.nodes.filter((entry) => entry.id === id || entry.parentIds.includes(id)),
	};
}

// eslint-disable-next-line max-params -- Fixture identity, title, status and overrides stay visible at the call site.
function card(id: string, title: string, status: string, patch: Partial<Card> = {}): Card {
	return {
		id,
		title,
		status,
		assignee: null,
		beeAssignments: [],
		priority: 2,
		labels: ["ui", "graph"],
		updatedAt: OBSERVED_AT,
		...patch,
	};
}
