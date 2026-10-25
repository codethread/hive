import type { BoardFilter, CardAnnotations, Hierarchy } from "../../contracts.ts";
import {
	annotations,
	boardHierarchyKey,
	boards,
	hierarchies,
	loadAnnotations,
	loadBoard,
	loadHierarchy,
	snapshot,
} from "../../src/data.ts";
import { board, hierarchy } from "../../src/stories/fixtures.ts";
import { boardKey, hierarchyKey } from "../../contracts.ts";

import { expect, spyOn, test } from "bun:test";

const SECOND_PAGE = 2;
const REQUEST_PAGE = 3;
const BACKGROUND_READS = 4;

// eslint-disable-next-line max-statements -- Check shared production stores through controlled HTTP responses.
test("production board loading encodes demand and publishes shared background resources", async () => {
	const colony = "client-board-wiring";
	const filter: BoardFilter = {
		view: "beads",
		requestPage: 0,
		page: SECOND_PAGE,
		query: "a & b",
		all: ["x,y"],
		any: [],
		exclude: [],
		statuses: ["open"],
		priorities: [SECOND_PAGE],
		closed: false,
	};
	const card = { ...board.cards[0]!, id: "card & one" };
	const root = { ...card, id: "root+two", parentIds: [] };
	const value = { ...board, cards: [card] };
	const family: Hierarchy = { ...hierarchy, nodes: [root, { ...card, parentIds: [root.id] }] };
	const annotationResponses: CardAnnotations[] = [
		{
			fetchedAt: value.fetchedAt,
			cards: [
				{
					id: "card & one",
					status: card.status,
					assignee: card.assignee,
					updatedAt: card.updatedAt,
					beeAssignments: card.beeAssignments,
					merges: card.merges,
					sources: { merges: 1, assignments: 1 },
				},
			],
		},
		{
			fetchedAt: value.fetchedAt,
			cards: [
				{
					id: "root+two",
					status: root.status,
					assignee: root.assignee,
					updatedAt: root.updatedAt,
					beeAssignments: root.beeAssignments,
					merges: root.merges,
					sources: { merges: 1, assignments: 1 },
				},
			],
		},
	];
	const gate = Promise.withResolvers<Response>();
	const entered = Promise.withResolvers<void>();
	const reads: URL[] = [];
	const saved = {
		boards: boards.store.getState(),
		annotations: annotations.store.getState(),
		hierarchies: hierarchies.store.getState(),
	};
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: URL | RequestInfo) => {
				const path = new URL(clientPath(input), "http://hive");
				reads.push(path);
				if (path.pathname.endsWith("/board")) {
					return Promise.resolve(Response.json(value));
				}
				if (path.pathname.endsWith("/hierarchy")) {
					entered.resolve();
					return gate.promise;
				}
				return Promise.resolve(Response.json(annotationResponses.shift()!));
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	const pending = loadBoard(colony, filter, { refreshAfter: 1 });
	try {
		await entered.promise;
		expect(boards.store.getState().entries[boardKey(colony, filter)]?.kind).toBe("ready");
		expect(snapshot(boards.store.getState().entries[boardKey(colony, filter)]!)).toEqual(value);
		expect(reads.map((path) => path.pathname)).toEqual([
			`/api/colonies/${colony}/board`,
			`/api/colonies/${colony}/annotations`,
			`/api/colonies/${colony}/hierarchy`,
		]);
		expect(reads[0]?.searchParams.get("filter")).toBe(JSON.stringify(filter));
		expect(reads[1]?.searchParams.get("ids")).toBe(JSON.stringify([card.id]));
		expect(reads[SECOND_PAGE]?.searchParams.get("ids")).toBe(JSON.stringify([card.id]));
		expect(reads[1]?.search).toBe("?ids=%5B%22card+%26+one%22%5D&refreshAfter=1");
		expect(reads[SECOND_PAGE]?.search).toBe("?ids=%5B%22card+%26+one%22%5D&refreshAfter=1");
		gate.resolve(Response.json(family));
		await pending;
		expect(reads[REQUEST_PAGE]?.searchParams.get("ids")).toBe(JSON.stringify([root.id]));
		expect(reads[REQUEST_PAGE]?.search).toBe("?ids=%5B%22root%2Btwo%22%5D&refreshAfter=1");
		expect(annotationResponses).toEqual([]);
		expect(reads.every((path) => path.searchParams.get("refreshAfter") === "1")).toBe(true);
		expect(
			snapshot(hierarchies.store.getState().entries[boardHierarchyKey(colony, filter)]!),
		).toEqual(family);
		expect(
			snapshot(hierarchies.store.getState().entries[hierarchyKey(colony, [card.id])]!),
		).toEqual(family);
		expect(
			snapshot(annotations.store.getState().entries[hierarchyKey(colony, [root.id])]!)?.cards[0]
				?.id,
		).toBe(root.id);
		await loadHierarchy(colony, [card.id]);
		await loadAnnotations(colony, [card.id, root.id]);
		expect(reads).toHaveLength(BACKGROUND_READS);
	} finally {
		gate.resolve(Response.json(family));
		await pending;
		fetch.mockRestore();
		boards.store.setState(saved.boards);
		annotations.store.setState(saved.annotations);
		hierarchies.store.setState(saved.hierarchies);
	}
});

test.each(["open", "completed"] as const)(
	"production %s request boards omit hierarchy reads",
	// eslint-disable-next-line max-statements -- Keep request-scope demand and cleanup together.
	async (view) => {
		const filter: BoardFilter = {
			view,
			request: "request & one",
			requestPage: REQUEST_PAGE,
			page: 1,
			query: "",
			all: [],
			any: [],
			exclude: [],
			statuses: [],
			priorities: [],
			closed: false,
		};
		const colony = `client-board-${view}`;
		const value = { ...board, cards: [{ ...board.cards[0]! }] };
		const reads: URL[] = [];
		const saved = { boards: boards.store.getState(), annotations: annotations.store.getState() };
		const fetch = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				(input: URL | RequestInfo) => {
					const path = new URL(clientPath(input), "http://hive");
					reads.push(path);
					if (path.pathname.endsWith("/board")) {
						return Promise.resolve(Response.json(value));
					}
					return Promise.resolve(Response.json({ cards: [], fetchedAt: value.fetchedAt }));
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
		try {
			await loadBoard(colony, filter);
			expect(reads.map((path) => path.pathname)).toEqual([
				`/api/colonies/${colony}/board`,
				`/api/colonies/${colony}/annotations`,
			]);
			expect(reads[0]?.searchParams.get("filter")).toBe(JSON.stringify(filter));
			expect(reads.every((path) => path.searchParams.get("refreshAfter") === "0")).toBe(true);
		} finally {
			fetch.mockRestore();
			boards.store.setState(saved.boards);
			annotations.store.setState(saved.annotations);
		}
	},
);

test.each(["transport", "non-OK", "JSON", "schema"])(
	"production board %s failure retains previous data without background reads",
	// eslint-disable-next-line max-statements -- Include cold setup and retained-data refresh in each failure case.
	async (failure) => {
		const colony = `client-board-failure-${failure}`;
		const filter: BoardFilter = {
			view: "beads",
			requestPage: 0,
			page: 0,
			query: "",
			all: [],
			any: [],
			exclude: [],
			statuses: [],
			priorities: [],
			closed: false,
		};
		const value = { ...board, cards: [{ ...board.cards[0]! }] };
		const saved = boards.store.getState();
		let fail = false;
		const reads: string[] = [];
		const fetch = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				// eslint-disable-next-line max-statements -- Exercise distinct transport and parser failure paths.
				(input: URL | RequestInfo) => {
					reads.push(clientPath(input));
					if (!fail) {
						return Promise.resolve(Response.json(value));
					}
					if (failure === "transport") {
						return Promise.reject(new TypeError("Network unavailable"));
					}
					if (failure === "non-OK") {
						return Promise.resolve(
							Response.json({ ...value, message: "Board unavailable" }, { status: 503 }),
						);
					}
					let body = "{}";
					if (failure === "JSON") {
						body = "{";
					}
					return Promise.resolve(new Response(body));
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
		try {
			await loadBoard(colony, filter, { background: false });
			const previous = snapshot(boards.store.getState().entries[boardKey(colony, filter)]!);
			expect(previous).toEqual(value);
			fail = true;
			await loadBoard(colony, filter, { refreshAfter: 1 });
			const resource = boards.store.getState().entries[boardKey(colony, filter)]!;
			expect(resource.kind).toBe("failed");
			expect(snapshot(resource)).toBe(previous);
			expect(reads).toHaveLength(SECOND_PAGE);
		} finally {
			fetch.mockRestore();
			boards.store.setState(saved);
		}
	},
);

function clientPath(input: URL | RequestInfo): string {
	if (typeof input !== "string") {
		throw new TypeError("Expected a client API path");
	}
	return input;
}
