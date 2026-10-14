import type { BeadFilter, Card, Detail, Hierarchy } from "../../contracts.ts";
import { HttpResponse, http } from "msw";
import {
	OBSERVED_AT,
	ancestry,
	bees,
	board,
	colony,
	completedBees,
	cards as fixtureCards,
	fixtureDetail,
	fixtureFamily,
	fixtureOutline,
	hierarchy,
} from "./fixtures.ts";
import { boardFilterSchema, inventoryFilterSchema } from "../../contracts.ts";

import { z } from "zod";

/** Only fixture responses are served; no Storybook action reaches a native tracker. */
export const handlers = [
	http.get("/api/colonies", () => HttpResponse.json({ colonies: [colony] })),
	...beadHandlers(hierarchy, fixtureDetail),
	http.get("/api/colonies/:colony/inventory", ({ request }) => {
		const filter = inventoryFilterSchema.parse(
			JSON.parse(new URL(request.url).searchParams.get("filter")!),
		);
		const candidates = filter.view === "completed" ? completedBees : bees;
		const narrowed =
			filter.query !== "" ||
			filter.statuses.length > 0 ||
			filter.priorities.length > 0 ||
			filter.all.length > 0 ||
			filter.any.length > 0 ||
			filter.exclude.length > 0;
		return HttpResponse.json({
			kind: "loaded",
			bees: candidates.filter(
				(bee) =>
					!narrowed ||
					fixtureCards.some((card) => bee.taskIds.includes(card.id) && matches(card, filter)),
			),
			total: candidates.length,
			hasMore: false,
			readAt: OBSERVED_AT,
		});
	}),
	http.get("/api/colonies/:colony/provenance/:id", ({ params }) => {
		const selected = [...bees, ...completedBees].find((bee) => bee.id === params["id"])!;
		return HttpResponse.json(
			selected.id === bees[0]!.id
				? ancestry
				: {
						...ancestry,
						chain: [selected],
						end: { kind: "unmatched", requester: selected.requester },
					},
		);
	}),
	http.all("/api/*", () =>
		HttpResponse.json({ message: "No Storybook fixture for this API request." }, { status: 500 }),
	),
];

/** Keep scenario navigation on the production board, hierarchy, detail and outline contracts. */
export function beadHandlers(source: Hierarchy, detail: (id: string) => Detail) {
	return [
		http.get("/api/colonies/:colony/board", ({ request }) => {
			const filter = boardFilterSchema.parse(
				JSON.parse(new URL(request.url).searchParams.get("filter")!),
			);
			const linked = [...bees, ...completedBees].find((bee) => bee.id === filter.request);
			const cards = source.nodes.filter(
				(card) =>
					matches(card, filter) &&
					(filter.view === "beads" || linked?.taskIds.includes(card.id) === true),
			);
			return HttpResponse.json({ ...board, cards });
		}),
		http.get("/api/colonies/:colony/hierarchy", ({ request }) => {
			const ids = z
				.array(z.string())
				.parse(JSON.parse(new URL(request.url).searchParams.get("ids")!));
			const nodes = new Map(
				ids.flatMap((id) => fixtureFamily(id, source).nodes).map((node) => [node.id, node]),
			);
			return HttpResponse.json({ fetchedAt: OBSERVED_AT, nodes: [...nodes.values()] });
		}),
		http.get("/api/colonies/:colony/beads/:id", ({ params }) =>
			HttpResponse.json(detail(String(params["id"]))),
		),
		http.get("/api/colonies/:colony/outline/:id", ({ params }) =>
			HttpResponse.json(fixtureOutline(String(params["id"]), source)),
		),
	];
}

function matches(card: Card, filter: BeadFilter): boolean {
	return (
		(filter.closed || filter.statuses.includes("closed") || card.status !== "closed") &&
		(filter.query === "" ||
			`${card.id} ${card.title}`.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase())) &&
		(filter.statuses.length === 0 || filter.statuses.includes(card.status)) &&
		(filter.priorities.length === 0 || filter.priorities.includes(card.priority)) &&
		filter.all.every((label) => card.labels.includes(label)) &&
		(filter.any.length === 0 || filter.any.some((label) => card.labels.includes(label))) &&
		filter.exclude.every((label) => !card.labels.includes(label))
	);
}
