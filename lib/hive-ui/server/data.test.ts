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
const PROJECTION_FIELDS = 2;
const LAST_ITEM = -1;
const seeded = await workflowFixture();
const workflowCache = await workflowFixture();
const incremental = await workflowFixture();
await incremental.context.beads.close(scope, incremental.checkpoint.id);
const retried = await workflowFixture();
await retried.context.beads.create(scope, {
	title: "Second checkpoint",
	labels: ["system", "busybee-checkpoint"],
	description: JSON.stringify({ id: "other-run", created: [] }),
});
const linked = await mergeFixture();
const selected = await mergeFixture();
const evidence = await selected.beads.create(scope, { title: "Related evidence" });
await selected.beads.dep.add(scope, selected.task.id, evidence.id, "related");
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
	return {
		root,
		checkpoint,
		manual,
		context: { beads, colony, requestId: "test", log: async () => {} },
	};
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

test(
	"board and inventory project cross-host attribution without requiring execution " +
		"assignment #test-371",
	// eslint-disable-next-line max-statements -- One request fixture verifies both public projections.
	async () => {
		const beads = createMemoryBeads();
		const task = await beads.create(scope, {
			title: "Work",
			status: "in_progress",
			assignee: "friendly-bee",
			owner: "ct",
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
		expect(board.cards.find((card) => card.id === task.id)?.owner).toBe("ct");
		const annotations = await data.annotations(context, [task.id], 0);
		expect(
			annotations.cards.find((card) => card.id === task.id)?.beeAssignments.map((bee) => bee.id),
		).toEqual([request.id]);
		const inventory = await data.inventory(
			context,
			inventoryFilterSchema.parse({ view: "open" }),
			0,
		);
		expect(inventory.kind).toBe("loaded");
		if (inventory.kind === "loaded") {
			expect(inventory.bees.map((bee) => bee.id)).toEqual([request.id]);
		}
	},
);

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

// eslint-disable-next-line max-statements -- Verify native index reuse and fresh generated-visit discovery together.
test("workflow polling reuses the identity index and immediately refreshes a missing visit #test-577", async () => {
	let reads = 0;
	const context = {
		...workflowCache.context,
		beads: {
			...workflowCache.context.beads,
			listProjected: (...args: Parameters<typeof workflowCache.context.beads.listProjected>) => {
				if (args[PROJECTION_FIELDS].includes("description")) {
					reads += 1;
				}
				return workflowCache.context.beads.listProjected(...args);
			},
		},
	};
	const data = createBoardData(unrequestedTopology, () => 1);
	const inspect = (_endpoint: unknown, id: string) => Promise.resolve(id);
	await data.workflow(context, workflowCache.root.id, inspect);
	await data.workflow(context, workflowCache.root.id, inspect);
	expect(reads).toBe(1);
	await context.beads.update(scope, [workflowCache.checkpoint.id], {
		description: JSON.stringify({ id: workflowCache.root.id, created: [{ bead: "new-visit" }] }),
	});
	expect(await data.workflow(context, "new-visit", inspect)).toBe(workflowCache.root.id);
	expect(reads).toBe(COLD_AND_RECOVERY_READS);
});

// eslint-disable-next-line max-statements -- Verify revision reuse and closed provenance across refreshes.
test("fresh boards hydrate only changed workflow identities and retire removed checkpoints #test-569", async () => {
	const descriptions: string[][] = [];
	const context = {
		...incremental.context,
		beads: {
			...incremental.context.beads,
			listProjected: (...args: Parameters<typeof incremental.context.beads.listProjected>) => {
				if (args[PROJECTION_FIELDS].includes("description")) {
					descriptions.push([...(args[1].ids ?? [])]);
				}
				return incremental.context.beads.listProjected(...args);
			},
		},
	};
	let clock = 1;
	const data = createBoardData(unrequestedTopology, () => clock);
	const first = await data.board(context, filter, clock);
	expect(first.cards.find((card) => card.id === incremental.root.id)?.isWorkflowGenerated).toBe(
		true,
	);
	await data.board(context, filter, ++clock);
	expect(descriptions).toEqual([[]]);
	await context.beads.update(scope, [incremental.checkpoint.id], {
		description: JSON.stringify({
			id: incremental.root.id,
			created: [{ bead: incremental.manual.id }],
		}),
	});
	const changed = await data.board(context, filter, ++clock);
	expect(changed.cards.find((card) => card.id === incremental.manual.id)?.isWorkflowGenerated).toBe(
		true,
	);
	expect(descriptions).toEqual([[], [incremental.checkpoint.id]]);
	await context.beads.update(scope, [incremental.checkpoint.id], {
		removeLabels: ["busybee-checkpoint"],
	});
	const removed = await data.board(context, filter, ++clock);
	expect(removed.cards.every((card) => !card.isWorkflowGenerated)).toBe(true);
	expect(descriptions).toHaveLength(COLD_AND_RECOVERY_READS);
});

test("a failed workflow identity refresh cannot publish a partially parsed index #test-592", async () => {
	let fail = true;
	const batches: string[][] = [];
	const context = {
		...retried.context,
		beads: {
			...retried.context.beads,
			listProjected: async (...args: Parameters<typeof retried.context.beads.listProjected>) => {
				const page = await retried.context.beads.listProjected(...args);
				if (args[PROJECTION_FIELDS].includes("description")) {
					batches.push([...(args[1].ids ?? [])]);
					if (fail) {
						page.issues.at(LAST_ITEM)!.description = "invalid checkpoint JSON";
					}
				}
				return page;
			},
		},
	};
	const data = createBoardData(unrequestedTopology, () => 1);
	const inspect = (_endpoint: unknown, id: string) => Promise.resolve(id);
	const failure = await data
		.workflow(context, retried.root.id, inspect)
		.catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(SyntaxError);
	fail = false;
	expect(await data.workflow(context, retried.root.id, inspect)).toBe(retried.root.id);
	expect(batches).toEqual([[], []]);
});

test("workflow identity snapshots are isolated by selected endpoint", async () => {
	const data = createBoardData(unrequestedTopology, () => 1);
	const inspect = (_endpoint: unknown, id: string) => Promise.resolve(id);
	await data.workflow(retried.context, retried.root.id, inspect);
	const context = { ...retried.context, colony: { ...colony, id: "another-endpoint" } };
	let descriptions = 0;
	context.beads = {
		...context.beads,
		listProjected: (...args: Parameters<typeof retried.context.beads.listProjected>) => {
			if (args[PROJECTION_FIELDS].includes("description")) {
				descriptions++;
			}
			return retried.context.beads.listProjected(...args);
		},
	};
	await data.workflow(context, retried.root.id, inspect);
	expect(descriptions).toBe(1);
});

test("primary cards and families never hydrate tasks or wait for merge and assignment icons #test-484", async () => {
	const data = createBoardData(async (_colony, consume) => ({
		stale: false,
		value: await consume({
			stale: false,
			nodes: [{ id: linked.task.id, status: "open", labels: [] }],
			edges: [],
			fetchedAt: "2026-10-15T00:00:00Z",
		}),
	}));
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

test("merge icons read both directions of labelled, closed and malformed references #test-567", async () => {
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

test("selected detail classifies its merge links without reading global merge metadata #test-584", async () => {
	const beads = {
		...selected.beads,
		listProjected: (...args: Parameters<typeof selected.beads.listProjected>) => {
			if (args[1].labels?.includes("merge") === true && args[1].ids === undefined) {
				throw new Error("Global merge scan must remain deferred");
			}
			return selected.beads.listProjected(...args);
		},
		dep: {
			...selected.beads.dep,
			list: () => Promise.reject(new Error("Merge icon metadata unavailable")),
		},
	};
	const data = createBoardData(unrequestedTopology);
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const detail = await data.detail(context, selected.task.id, {
		scope: { view: "beads", requestPage: 0 },
		refreshAfter: 0,
	});
	expect(detail.card.id).toBe(selected.task.id);
	expect(detail.card.merges).toEqual([]);
	expect(detail.dependencies.items.map((edge) => edge.id)).toEqual([evidence.id]);
	expect(detail.dependencies.total).toBe(1);
	expect(detail.dependents.total).toBe(0);
});

test("a request without tasks skips repository-wide task and workflow queries #test-568", async () => {
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
test("failed graph validation never seeds the complete-family cache #test-506", async () => {
	let fail = true;
	let reads = 0;
	const fetchedAt = "2026-10-15T00:00:00Z";
	const data = createBoardData(
		async (_colony, consume) => {
			reads++;
			const value = await consume({
				stale: false,
				nodes: [{ id: linked.task.id, status: "open", labels: [] }],
				edges: [],
				fetchedAt,
			});
			if (fail) {
				throw new Error("Export changed during hydration");
			}
			return { value, stale: false };
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
