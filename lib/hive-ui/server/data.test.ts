/* eslint-disable unicorn/no-null -- Captured recipes explicitly retain absent cwd. */
import { expect, test } from "bun:test";
import type { BoardFilter } from "../contracts.ts";
import { PAGE_SIZE } from "../contracts.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";

const FIRST_SAMPLE = 0;
const defaultFilter: BoardFilter = {
	all: [],
	any: [],
	closed: false,
	exclude: [],
	priorities: [],
	query: "",
	statuses: [],
	page: 0,
	requestPage: 0,
	view: "beads",
};
const colony = {
	beadsDb: "/tracker/beads.db",
	id: "fixture",
	name: "Fixture",
	root: "/repo",
	statuses: ["open", "closed"],
};
const recipe = {
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "",
	system_prompt: "",
};

function fixture() {
	const beads = createMemoryBeads();
	const samples: object[] = [];
	const scope = { actor: "seed", cwd: colony.root, db: colony.beadsDb };
	const context = {
		beads,
		colony,
		log: (sample: object) => {
			samples.push(sample);
			return Promise.resolve();
		},
		requestId: "read-test",
	};
	return { beads, context, data: createBoardData(), samples, scope };
}

// eslint-disable-next-line max-statements -- Seed predicates and verify the user-visible board and detail through the public reader.
test("ordinary board applies task predicates and projects detail comments and relationships", async () => {
	const { beads, context, data, samples, scope } = fixture();
	const task = await beads.create(scope, {
		title: "Fix reader",
		description: "Reader details",
		acceptanceCriteria: "Readable board",
		priority: 1,
		labels: ["ui", "important"],
	});
	const other = await beads.create(scope, { title: "Other", priority: 1, labels: ["ui"] });
	await beads.create(scope, {
		title: "Fix reader automation",
		labels: ["system", "ui", "important"],
	});
	await beads.dep.add(scope, task.id, other.id, "related");
	await beads.comments.add({ ...scope, actor: "reviewer" }, task.id, "Review details");
	const board = await data.board(
		context,
		{ ...defaultFilter, all: ["ui", "important"], query: "Fix reader" },
		0,
	);
	expect(board.cards.map(({ id }) => id)).toEqual([task.id]);
	expect(board.labels).toEqual(["important", "ui"]);
	expect(board.query).toContain("--no-auto-import");
	expect(board.query).toContain(colony.beadsDb);
	const detail = await data.detail(context, task.id, {
		refreshAfter: 0,
		scope: { requestPage: 0, view: "beads" },
	});
	expect(detail).toMatchObject({
		acceptanceCriteria: "Readable board",
		description: "Reader details",
		comments: [{ author: "reviewer", text: "Review details" }],
		dependencies: {
			items: [{ dependencyType: "related", id: other.id, title: "Other" }],
			total: 1,
		},
	});
	expect(samples[FIRST_SAMPLE]).toMatchObject({
		outcome: "ok",
		requestId: "read-test",
		scope: "native",
	});
});

// eslint-disable-next-line max-statements -- Preserve linked membership independently of filters and an empty request.
test("request views restrict work to related tasks and filter inventory by linked task predicates", async () => {
	const { beads, context, data, scope } = fixture();
	const match = await beads.create(scope, {
		title: "Matching task",
		labels: ["selected"],
		assignee: "worker-bee",
	});
	await beads.update(scope, [match.id], { status: "in_progress" });
	await beads.create(scope, { title: "Unrelated", labels: ["selected"] });
	const request = await beads.create(scope, {
		title: "Request",
		labels: ["system", "bee", "agent:worker"],
		assignee: "worker-bee",
		description: JSON.stringify(recipe),
	});
	const emptyRequest = await beads.create(scope, {
		title: "Empty request",
		labels: ["system", "bee", "agent:worker"],
		assignee: "empty-bee",
		description: JSON.stringify(recipe),
	});
	await beads.dep.add(scope, request.id, match.id, "related");
	const board = await data.board(
		context,
		{ ...defaultFilter, request: request.id, view: "open" },
		0,
	);
	expect(board.cards).toMatchObject([
		{ id: match.id, beeAssignments: [{ id: request.id, kind: "worker" }] },
	]);
	const empty = await data.board(
		context,
		{ ...defaultFilter, request: emptyRequest.id, view: "open" },
		0,
	);
	expect(empty.cards).toEqual([]);
	expect(empty.query).toEqual([]);
	const inventory = await data.inventory(
		context,
		{ ...defaultFilter, all: ["selected"], view: "open" },
		0,
	);
	expect(inventory).toMatchObject({ bees: [{ id: request.id }], kind: "loaded", total: 2 });
});

// eslint-disable-next-line max-statements -- Verify both pages and lookahead from one memory fixture.
test("ordinary board retains lookahead and page offsets", async () => {
	const { beads, context, data, scope } = fixture();
	const readScopes: object[] = [];
	context.beads = {
		...beads,
		list: (readScope, selection) => {
			readScopes.push(readScope);
			return beads.list(readScope, selection);
		},
	};
	const count = PAGE_SIZE + 1;
	/* eslint-disable no-await-in-loop -- Memory fixture writes are deterministic and contain no IO. */
	for (let index = 0; index < count; index++) {
		await beads.create(scope, { title: `Task ${index}`, priority: 2 });
	}
	/* eslint-enable no-await-in-loop */
	const first = await data.board(context, defaultFilter, 0);
	const second = await data.board(context, { ...defaultFilter, page: 1 }, 0);
	expect(first.cards).toHaveLength(PAGE_SIZE);
	expect(first.hasMore).toBe(true);
	expect(second.cards).toHaveLength(1);
	expect(second.hasMore).toBe(false);
	expect(first.cards.map(({ id }) => id)).not.toContain(second.cards[0]!.id);
	expect(readScopes).toEqual(
		Array.from({ length: 2 }, () => ({
			actor: "hive-ui",
			cwd: colony.root,
			db: colony.beadsDb,
			noAutoImport: true,
			noAutoFlush: true,
		})),
	);
});
