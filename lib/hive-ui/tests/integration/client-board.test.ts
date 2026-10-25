import { boards, loadBoard, snapshot } from "../../src/data.ts";
import { expect, spyOn, test } from "bun:test";
import type { BoardFilter } from "../../contracts.ts";
import { board } from "../../src/stories/fixtures.ts";
import { boardKey } from "../../contracts.ts";

test.each(["transport", "non-OK", "JSON", "schema"])(
	"production board %s failure retains previous data without background reads",
	// eslint-disable-next-line max-statements
	async (failure) => {
		const colony = `client-board-failure-${failure}`;
		const filter = boardFilter();
		const value = { ...board, cards: [] };
		const saved = boards.store.getState();
		const reads: string[] = [];
		let recovered = false;
		const refreshed = { ...value, fetchedAt: "2026-10-12T00:00:01Z" };
		const fetch = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				// eslint-disable-next-line max-statements -- Exercise distinct transport and parser failure paths.
				(input: URL | RequestInfo) => {
					reads.push(clientPath(input));
					if (recovered) {
						return Promise.resolve(Response.json(refreshed));
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
			boards.store.setState({
				entries: {
					...saved.entries,
					[boardKey(colony, filter)]: { kind: "ready", data: value, receivedAt: 0 },
				},
			});
			await loadBoard(colony, filter, { refreshAfter: 1 });
			const resource = boards.store.getState().entries[boardKey(colony, filter)]!;
			expect(resource.kind).toBe("failed");
			expect(snapshot(resource)).toBe(value);
			expect(reads).toHaveLength(1);
			if (failure === "schema") {
				recovered = true;
				await loadBoard(colony, filter, { refreshAfter: 1, background: false });
				const current = boards.store.getState().entries[boardKey(colony, filter)]!;
				expect(current.kind).toBe("ready");
				expect(snapshot(current)).toEqual(refreshed);
			}
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

function boardFilter(): BoardFilter {
	return {
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
}
