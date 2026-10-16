import type { BeadsScope, DependencySelection } from "@hive/beads";
import { boardFilterSchema, inventoryFilterSchema } from "../contracts.ts";
import { expect, test } from "bun:test";
import { samplePreview, workflowSamples } from "../src/stories/workflow-samples.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";

const scope = { cwd: colony.root, db: colony.beadsDb, actor: "fixture" };
const filter = boardFilterSchema.parse({ view: "beads", closed: true });
const COLD_AND_RECOVERY_READS = 2;
const seeded = await workflowFixture();
const linked = await mergeFixture();
const emptyRequest = await linked.beads.create(scope, {
	title: "Request without tasks",
	labels: ["system", "bee", "agent:worker"],
	assignee: "requester",
	description: JSON.stringify({ harness: "codex", kind: "worker", model: "gpt-6-astra" }),
});

async function workflowFixture() {
	const beads = createMemoryBeads();
	const root = await beads.create(scope, { title: "Run" });
	const manual = await beads.create(scope, { title: "Agent-created child", parent: root.id });
	const checkpoint = await beads.create(scope, {
		title: "Workflow system bead",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify({ id: root.id, created: [] }),
	});
	await beads.dep.add(scope, root.id, checkpoint.id, "related");
	return { manual, context: { beads, colony, requestId: "test", log: async () => {} } };
}

async function mergeFixture() {
	const beads = createMemoryBeads();
	const task = await beads.create(scope, { title: "Task with a merge" });
	const merged = await beads.create(scope, {
		title: "Merged request",
		status: "closed",
		labels: ["merge"],
		description: JSON.stringify({
			url: "https://github.com/example/repo/pull/1",
			branch: "work",
			resolution: "merged",
		}),
	});
	await beads.dep.add(scope, task.id, merged.id, "relates-to");
	const invalid = await beads.create(scope, {
		title: "Invalid merge",
		labels: ["merge"],
		description: "bad",
	});
	await beads.dep.add(scope, invalid.id, task.id, "relates-to");
	return { beads, task, merged, invalid };
}

// eslint-disable-next-line max-statements -- One request fixture verifies both public projections.
test("board and inventory project cross-host attribution without requiring execution assignment", async () => {
	const beads = createMemoryBeads();
	const task = await beads.create(scope, {
		title: "Work",
		status: "in_progress",
		assignee: "friendly-bee",
	});
	const request = await beads.create(scope, {
		title: "Request",
		status: "open",
		assignee: "friendly-bee",
		labels: ["system", "bee", "agent:worker"],
		description: JSON.stringify({
			harness: "codex",
			kind: "worker",
			model: "gpt-6-astra",
			host: "another-host",
		}),
	});
	await beads.dep.add(scope, request.id, task.id, "related");
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const data = createBoardData(unrequestedTopology);
	const board = await data.board(context, filter, 0);
	expect(board.cards.find((card) => card.id === task.id)?.beeAssignments).toEqual([]);
	const annotations = await data.annotations(context, [task.id], 0);
	expect(
		annotations.cards.find((card) => card.id === task.id)?.beeAssignments.map((bee) => bee.id),
	).toEqual([request.id]);
	const inventory = await data.inventory(context, inventoryFilterSchema.parse({ view: "open" }), 0);
	expect(inventory.kind).toBe("loaded");
	if (inventory.kind === "loaded") {
		expect(inventory.bees.map((bee) => bee.id)).toEqual([request.id]);
	}
});

test("ordinary children cannot open an ancestor workflow", async () => {
	let calls = 0;
	const readPreview = () => {
		calls++;
		return Promise.resolve(samplePreview(workflowSamples[0]!));
	};
	const result = await createBoardData(unrequestedTopology)
		.workflow(seeded.context, seeded.manual.id, readPreview)
		.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(calls).toBe(0);
});

test("primary cards and families never hydrate tasks or wait for merge and assignment icons", async () => {
	const data = createBoardData((_colony, consume) =>
		consume({
			nodes: [{ id: linked.task.id, status: "open", labels: [] }],
			edges: [],
			fetchedAt: "2026-10-15T00:00:00Z",
		}),
	);
	const beads = {
		...linked.beads,
		showMany: () => Promise.reject(new Error("Task detail must remain lazy")),
		dep: {
			...linked.beads.dep,
			list: () => Promise.reject(new Error("Merge metadata unavailable")),
		},
	};
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const board = await data.board(context, filter, 0);
	expect(board.cards.map((card) => card.id)).toEqual([linked.task.id]);
	const family = await data.hierarchy(context, [linked.task.id], 0);
	expect(family.nodes.map((node) => node.id)).toEqual([linked.task.id]);
	expect(family.fetchedAt).toBe("2026-10-15T00:00:00Z");
});

test("merge icons read labelled references in both directions, including closed and malformed records", async () => {
	const calls: string[] = [];
	const beads = {
		...linked.beads,
		showMany: () => Promise.reject(new Error("Task detail must remain lazy")),
		dep: {
			...linked.beads.dep,
			list: (tracker: BeadsScope, id: string, selection: DependencySelection) => {
				calls.push(id);
				return linked.beads.dep.list(tracker, id, selection);
			},
		},
	};
	const data = createBoardData(unrequestedTopology);
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const result = await data.annotations(context, [linked.task.id], 0);
	expect(result.cards[0]?.merges.map(({ id, kind }) => ({ id, kind }))).toEqual([
		{ id: linked.merged.id, kind: "valid" },
		{ id: linked.invalid.id, kind: "invalid" },
	]);
	await data.annotations(context, [linked.task.id], 0);
	expect(calls.toSorted()).toEqual([linked.merged.id, linked.invalid.id].toSorted());
});

test("a request without tasks never falls back to a repository-wide task or workflow query", async () => {
	const context = {
		beads: {
			...linked.beads,
			listProjected: () => Promise.reject(new Error("No task query expected")),
		},
		colony,
		requestId: "test",
		log: async () => {},
	};
	const board = await createBoardData(unrequestedTopology).board(
		context,
		boardFilterSchema.parse({ view: "open", request: emptyRequest.id }),
		0,
	);
	expect(board.cards).toEqual([]);
	expect(board.query).toEqual([]);
});

function unrequestedTopology(): Promise<never> {
	throw new Error("Graph must remain lazy");
}

// eslint-disable-next-line max-statements -- Check a failed observation, recovery and subsequent cache hit together.
test("failed graph validation never seeds the complete-family cache", async () => {
	let fail = true;
	let reads = 0;
	const fetchedAt = "2026-10-15T00:00:00Z";
	const data = createBoardData(
		async (_colony, consume) => {
			reads++;
			const value = await consume({
				nodes: [{ id: linked.task.id, status: "open", labels: [] }],
				edges: [],
				fetchedAt,
			});
			if (fail) {
				throw new Error("Export changed during hydration");
			}
			return value;
		},
		() => Date.parse(fetchedAt),
	);
	const context = { beads: linked.beads, colony, requestId: "test", log: async () => {} };
	const result = await data
		.hierarchy(context, [linked.task.id], 0)
		.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	fail = false;
	const fresh = await data.hierarchy(context, [linked.task.id], 0);
	const cached = await data.hierarchy(context, [linked.task.id], 0);
	expect(reads).toBe(COLD_AND_RECOVERY_READS);
	expect(cached).toEqual(fresh);
	expect(cached.fetchedAt).toBe(fetchedAt);
});
