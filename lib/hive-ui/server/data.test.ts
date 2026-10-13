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

// Seed predicates and verify the user-visible board and detail through the public reader.
// eslint-disable-next-line max-statements
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

test("exact hierarchy reads retain linked nodes omitted by native list", async () => {
	const { beads, context, data, scope } = fixture();
	const hidden = await beads.create(scope, { title: "Linked tombstone" });
	context.beads = {
		...beads,
		list: async (readScope, selection) => ({
			...(await beads.list(readScope, selection)),
			issues: [],
		}),
	};
	const result = await data.hierarchy(context, [hidden.id], 0);
	expect(result.nodes.map((node) => node.id)).toEqual([hidden.id]);
});

// eslint-disable-next-line max-statements -- Exercise coalescing, visible failure and recovery on one shared cache.
test("complete families are reused across overlapping reads and failed loads can be retried", async () => {
	const { beads, context, data, scope } = fixture();
	const root = await beads.create(scope, { title: "Root" });
	const child = await beads.create(scope, { title: "Child", parent: root.id });
	let edgeReads = 0;
	context.beads = {
		...beads,
		dep: {
			...beads.dep,
			list: (readScope, id, options) => {
				edgeReads++;
				return beads.dep.list(readScope, id, options);
			},
		},
	};
	const [family, same] = await Promise.all([
		data.hierarchy(context, [root.id], 0),
		data.hierarchy(context, [child.id], 0),
	]);
	expect(same.nodes).toEqual(family.nodes);
	expect(edgeReads).toBe(1);
	context.beads.dep.list = () => Promise.reject(new Error("Unavailable"));
	let failure: unknown = null;
	try {
		await data.hierarchy(context, [root.id], Number.MAX_SAFE_INTEGER);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(Error);
	context.beads.dep.list = beads.dep.list;
	const retried = await data.hierarchy(context, [root.id], Number.MAX_SAFE_INTEGER);
	expect(retried.nodes).toEqual(family.nodes);
});

// eslint-disable-next-line max-statements -- Reparenting must invalidate all aliases of both old components.
test("refresh invalidates old family aliases after a native reparent", async () => {
	const { beads, context, data, scope } = fixture();
	const left = await beads.create(scope, { title: "Left" });
	const right = await beads.create(scope, { title: "Right" });
	const child = await beads.create(scope, { title: "Moving", parent: left.id });
	await data.hierarchy(context, [left.id, right.id], 0);
	await beads.update(scope, [child.id], { parent: right.id });
	await data.hierarchy(context, [right.id], Number.MAX_SAFE_INTEGER);
	const oldFamily = await data.hierarchy(context, [left.id], 0);
	expect(oldFamily.nodes.map((node) => node.id)).toEqual([left.id]);
	const newFamily = await data.hierarchy(context, [child.id], 0);
	expect(newFamily.nodes.map((node) => node.id).toSorted()).toEqual(
		[right.id, child.id].toSorted(),
	);
});

// eslint-disable-next-line max-statements -- A queued scope must get its own read after the previous request fails.
test("failed hierarchy work does not fail a valid waiting scope with a newer cutoff", async () => {
	const { beads, context, data, scope } = fixture();
	const valid = await beads.create(scope, { title: "Valid" });
	const old = Promise.withResolvers<Awaited<ReturnType<typeof beads.list>>>();
	context.beads = {
		...beads,
		list: (readScope, selection) => {
			if (selection?.ids?.includes("missing") === true) {
				return old.promise;
			}
			return beads.list(readScope, selection);
		},
	};
	const failed = data.outline(context, "missing", 0);
	const waiting = data.hierarchy(context, [valid.id], Number.MAX_SAFE_INTEGER);
	const results = Promise.allSettled([failed, waiting]);
	old.reject(new Error("Old outline failed"));
	const [oldResult, newResult] = await results;
	expect(oldResult.status).toBe("rejected");
	if (oldResult.status === "rejected") {
		expect(oldResult.reason).toBeInstanceOf(Error);
	}
	if (newResult.status === "rejected") {
		throw newResult.reason;
	}
	expect(newResult.value.nodes.map((item) => item.id)).toEqual([valid.id]);
});
