import { ANNOTATION_BATCH, annotationKey, hierarchyKey } from "./contracts.ts";
import type { CardAnnotations, Hierarchy, HierarchyNode } from "./contracts.ts";
import {
	annotateCards,
	annotationStatus,
	createCardAnnotationsResource,
	createHierarchyResource,
	snapshot,
} from "./src/data.ts";
import { expect, test } from "bun:test";
import { colony } from "./src/stories/fixtures.ts";
import { createBoardData } from "./server/data.ts";
import { createMemoryBeads } from "@hive/beads";
import { z } from "zod";

const OLD = "2026-10-12T00:00:00Z";
const NEW = "2026-10-12T00:00:01Z";
const left = node("left");
const right = node("right");
const original: Hierarchy = {
	stale: false,
	nodes: [left, right, node("child", ["left"])],
	fetchedAt: OLD,
};
const moved: Hierarchy = { stale: false, nodes: [right, node("child", ["right"])], fetchedAt: NEW };

const SMALL_FAMILY = 2;
const CACHE_LIFETIME = 10_000;
const race = await annotationFixture();
const assignmentRace = await assignmentFixture();

// eslint-disable-next-line max-statements -- Verify reuse and expiry with one deterministic resource clock.
test("annotation demand reuses fresh singleton and overlapping aliases #test-403", async () => {
	const reads: string[][] = [];
	let now = Date.parse(NEW);
	const resource = createCardAnnotationsResource(
		(path) => {
			const ids = requestedIds(path);
			reads.push(ids);
			return Promise.resolve(annotationData(ids));
		},
		() => now,
	);
	await resource.loadBatch("colony", [left.id], now);
	await resource.loadBatch("colony", [left.id], now);
	await resource.loadBatch("colony", [left.id, right.id], now);
	expect(reads).toEqual([[left.id], [right.id]]);
	expect(
		annotationStatus("colony", [[left.id, right.id]], resource.store.getState().entries).kind,
	).toBe("ready");
	expect(
		snapshot(resource.store.getState().entries[batchKey([left.id, right.id])]!)?.cards.map(
			({ id }) => id,
		),
	).toEqual([left.id, right.id]);
	now += CACHE_LIFETIME;
	await resource.loadBatch("colony", [left.id], 0);
	expect(reads).toEqual([[left.id], [right.id], [left.id]]);
});

// eslint-disable-next-line max-statements -- Coordinate both read generations without timers or global clock changes.
test("newer annotation cutoffs wait for an older read and coalesce their refresh", async () => {
	const old = Promise.withResolvers<CardAnnotations>();
	const fresh = Promise.withResolvers<CardAnnotations>();
	const entered = Promise.withResolvers<void>();
	const reads: number[] = [];
	let now = Date.parse(OLD);
	const resource = createCardAnnotationsResource(
		(path) => {
			reads.push(Number(new URL(path, "http://hive").searchParams.get("refreshAfter")));
			if (reads.length === 1) {
				return old.promise;
			}
			entered.resolve();
			return fresh.promise;
		},
		() => now,
	);
	const initial = resource.loadBatch("colony", [left.id], now);
	now = Date.parse(NEW);
	const newer = resource.loadBatch("colony", [left.id], now);
	const duplicate = resource.loadBatch("colony", [left.id], now);
	expect(reads).toEqual([Date.parse(OLD)]);
	old.resolve(annotationData([left.id], OLD));
	await entered.promise;
	expect(reads).toEqual([Date.parse(OLD), Date.parse(NEW)]);
	fresh.resolve(annotationData([left.id]));
	await Promise.all([initial, newer, duplicate]);
	expect(reads).toHaveLength(SMALL_FAMILY);
	expect(snapshot(resource.store.getState().entries[batchKey([left.id])]!)?.fetchedAt).toBe(NEW);
});

// eslint-disable-next-line max-statements -- Verify retained icons, shared failure and explicit recovery together.
test("failed overlapping annotation demand retains icons and batch failure until retried #test-446", async () => {
	const failed = Promise.withResolvers<CardAnnotations>();
	let now = Date.parse(OLD);
	let fail = false;
	const resource = createCardAnnotationsResource(
		(path) => {
			const ids = requestedIds(path);
			if (fail) {
				return failed.promise;
			}
			return Promise.resolve(annotationData(ids));
		},
		() => now,
	);
	await resource.loadBatch("colony", [left.id, right.id], now);
	now = Date.parse(NEW);
	fail = true;
	const refresh = resource.loadBatch("colony", [left.id, right.id], now);
	const overlap = resource.loadBatch("colony", [left.id], now);
	expect(
		annotateCards([left], "colony", resource.store.getState().entries)[0]?.beeAssignments,
	).toHaveLength(1);
	failed.reject(new Error("Icons unavailable"));
	await Promise.all([refresh, overlap]);
	const { entries } = resource.store.getState();
	expect(annotationStatus("colony", [[left.id], [left.id, right.id]], entries).kind).toBe("failed");
	expect(snapshot(entries[batchKey([left.id, right.id])]!)?.cards).toHaveLength(SMALL_FAMILY);
	expect(annotateCards([left], "colony", entries)[0]?.beeAssignments).toHaveLength(1);
	fail = false;
	await resource.loadBatch("colony", [left.id, right.id], now);
	expect(
		annotationStatus("colony", [[left.id, right.id]], resource.store.getState().entries).kind,
	).toBe("ready");
});

test.each(["cold", "icons", "empty"])(
	"duplicate failed annotation demand publishes failure after %s state and recovers #test-522",
	// eslint-disable-next-line max-statements -- Verify shared rejection, retained data and retry through one read gate.
	async (seed) => {
		const rejected = Promise.withResolvers<CardAnnotations>();
		let now = Date.parse(OLD);
		let fail = false;
		let reads = 0;
		const resource = createCardAnnotationsResource(
			() => {
				reads++;
				if (fail) {
					return rejected.promise;
				}
				let ids: string[] = [];
				if (seed !== "empty") {
					ids = [left.id];
				}
				return Promise.resolve(annotationData(ids));
			},
			() => now,
		);
		if (seed !== "cold") {
			await resource.loadBatch("colony", [left.id], now);
		}
		const before = reads;
		now = Date.parse(NEW);
		fail = true;
		const first = resource.loadBatch("colony", [left.id], now);
		const duplicate = resource.loadBatch("colony", [left.id], now);
		rejected.reject(new Error("Shared icons unavailable"));
		await Promise.all([first, duplicate]);
		expect(reads).toBe(before + 1);
		const { entries } = resource.store.getState();
		expect(annotationStatus("colony", [[left.id]], entries).kind).toBe("failed");
		const retained = snapshot(entries[batchKey([left.id])]!);
		if (seed === "cold") {
			expect(retained).toBeNull();
		} else {
			expect(retained?.cards.length).toBe(Number(seed === "icons"));
		}
		const failureReads = reads;
		fail = false;
		await resource.loadBatch("colony", [left.id], 0);
		expect(reads).toBe(failureReads + 1);
		expect(annotationStatus("colony", [[left.id]], resource.store.getState().entries).kind).toBe(
			"ready",
		);
	},
);

// eslint-disable-next-line max-statements -- A cached completion must not clear a newer refresh notice.
test("cached annotation demand preserves a newer refresh notice #test-369", async () => {
	const delayed = Promise.withResolvers<CardAnnotations>();
	let now = Date.parse(OLD);
	const resource = createCardAnnotationsResource(
		() => {
			if (now === Date.parse(OLD)) {
				return Promise.resolve(annotationData([left.id], OLD));
			}
			return delayed.promise;
		},
		() => now,
	);
	await resource.loadBatch("colony", [left.id], now);
	const cached = resource.loadBatch("colony", [left.id], now);
	now = Date.parse(NEW);
	const fresh = resource.loadBatch("colony", [left.id], now);
	await cached;
	expect(annotationStatus("colony", [[left.id]], resource.store.getState().entries).kind).toBe(
		"loading",
	);
	delayed.reject(new Error("Icons unavailable"));
	await fresh;
	expect(annotationStatus("colony", [[left.id]], resource.store.getState().entries).kind).toBe(
		"failed",
	);
});

test("annotation demand caches absent IDs without dropping other cards #test-488", async () => {
	const reads: string[][] = [];
	const now = Date.parse(NEW);
	const resource = createCardAnnotationsResource(
		(path) => {
			const ids = requestedIds(path);
			reads.push(ids);
			return Promise.resolve(annotationData(ids.filter((id) => id !== "absent")));
		},
		() => now,
	);
	await resource.loadBatch("colony", [left.id, "absent"], now);
	await resource.loadBatch("colony", [left.id, "absent"], now);
	expect(reads).toEqual([["absent", left.id]]);
	expect(
		snapshot(resource.store.getState().entries[batchKey([left.id, "absent"])]!)?.cards.map(
			({ id }) => id,
		),
	).toEqual([left.id]);
});

test("an older board response cannot republish a family after a newer member refresh #test-623", async () => {
	const old = Promise.withResolvers<Hierarchy>();
	const resource = createHierarchyResource((path) => {
		if (path === "old") {
			return old.promise;
		}
		return Promise.resolve(moved);
	});
	const pending = resource.load(key(["left", "right"]), "old");
	await resource.load(key(["right"]), "new", true);
	old.resolve(original);
	await pending;
	expect(resource.store.getState().entries[key(["left", "right"])]?.kind).toBe("stale");
	expect(snapshot(resource.store.getState().entries[key(["child"])]!)?.nodes).toEqual(moved.nodes);
});

test.each(["success", "failure"])(
	"an older member %s preserves a newer complete alias",
	async (outcome) => {
		const old = Promise.withResolvers<Hierarchy>();
		const resource = createHierarchyResource((path) => {
			if (path === "old") {
				return old.promise;
			}
			return Promise.resolve(moved);
		});
		const pending = resource.load(key(["child"]), "old");
		await resource.load(key(["right"]), "new", true);
		if (outcome === "success") {
			old.resolve(original);
		} else {
			old.reject(new Error("Old read failed"));
		}
		await pending;
		expect(resource.store.getState().entries[key(["child"])]?.kind).toBe("ready");
		expect(snapshot(resource.store.getState().entries[key(["child"])]!)?.nodes).toEqual(
			moved.nodes,
		);
	},
);

// eslint-disable-next-line max-statements -- Keep the gated server/browser regression in one scenario.
test("a delayed mixed batch preserves refreshed icons with equal completion times #test-445", async () => {
	const { beads, scope, merge, task, assigned, context, data, now, warm, entered, release } = race;
	const resource = createCardAnnotationsResource((path) => {
		if (path === "old") {
			return data.annotations(context, [task.id, assigned.id], 0);
		}
		return data.annotations(context, [task.id], now + 1);
	});
	const pending = resource.load(batchKey([task.id, assigned.id]), "old");
	await entered.promise;
	await beads.update(scope, [merge.id], { title: "New merge" });
	await resource.load(batchKey([task.id]), "new", true);
	expect(
		snapshot(resource.store.getState().entries[key([task.id])]!)?.cards[0]?.merges[0]?.title,
	).toBe("New merge");
	release.resolve();
	await pending;
	const current = snapshot(resource.store.getState().entries[key([task.id])]!);
	expect(current?.fetchedAt).toBe(warm.fetchedAt);
	expect(current?.cards[0]?.updatedAt).toBe(warm.cards[0]?.updatedAt);
	expect(current?.cards[0]?.merges[0]?.title).toBe("New merge");
});

// eslint-disable-next-line max-statements -- Keep delayed delivery and request closure in one scenario.
test("a delayed cached batch preserves refreshed assignments at the same task revision #test-644", async () => {
	const { beads, scope, request, task, context, data, now } = assignmentRace;
	const old = await data.annotations(context, [task.id], 0);
	const delivery = Promise.withResolvers<CardAnnotations>();
	const resource = createCardAnnotationsResource((path) => {
		if (path === "old") {
			return delivery.promise;
		}
		return data.annotations(context, [task.id], now + 1);
	});
	const pending = resource.load(batchKey([task.id, "other"]), "old");
	await beads.close(scope, request.id);
	await resource.load(batchKey([task.id]), "new", true);
	delivery.resolve(old);
	await pending;
	const current = snapshot(resource.store.getState().entries[key([task.id])]!);
	expect(old.cards[0]?.beeAssignments.map((item) => item.id)).toEqual([request.id]);
	expect(current?.cards[0]?.beeAssignments).toEqual([]);
	expect(current?.cards[0]?.updatedAt).toBe(old.cards[0]?.updatedAt);
});

test.each([
	{
		status: "in_progress",
		assignee: "bee",
		observed: ["old-request"],
		expected: ["fresh-request"],
		revisionFirst: true,
	},
	{
		status: "closed",
		assignee: "bee",
		observed: [],
		expected: [],
		revisionFirst: false,
	},
	{
		status: "closed",
		assignee: "bee",
		observed: [],
		expected: [],
		revisionFirst: true,
	},
])(
	"annotations retain fresh merges and assignments for the latest task context: %j",
	// eslint-disable-next-line max-statements -- Keep revision and source ordering in one gated scenario.
	async (change) => {
		const delayed = Promise.withResolvers<CardAnnotations>();
		const fresh = {
			...left,
			status: "in_progress",
			assignee: "bee",
			beeAssignments: [{ id: "fresh-request", kind: "worker", stdout: null }],
			merges: [{ kind: "invalid" as const, id: "merge", title: "Fresh merge", problem: "bad" }],
			sources: { merges: 2, assignments: 2 },
		};
		const updated = {
			...fresh,
			status: change.status,
			assignee: change.assignee,
			updatedAt: NEW,
			beeAssignments: change.observed.map((id) => ({ id, kind: "worker", stdout: null })),
			merges: [{ ...fresh.merges[0]!, title: "Old merge" }],
			sources: { merges: 1, assignments: 1 },
		};
		const deliveries = [fresh, updated];
		if (change.revisionFirst) {
			deliveries.reverse();
		}
		const resource = createCardAnnotationsResource((path) => {
			if (path === "delayed") {
				return delayed.promise;
			}
			return Promise.resolve({ cards: [deliveries[0]!], fetchedAt: NEW });
		});
		const pending = resource.load(batchKey([left.id, right.id]), "delayed");
		await resource.load(batchKey([left.id]), "fresh");
		delayed.resolve({ cards: [deliveries[1]!], fetchedAt: NEW });
		await pending;
		const { entries } = resource.store.getState();
		const current = snapshot(entries[key([left.id])]!)?.cards[0];
		expect(current?.updatedAt).toBe(NEW);
		expect(current?.merges[0]?.title).toBe("Fresh merge");
		expect(current?.beeAssignments.map(({ id }) => id)).toEqual([...change.expected]);
		expect(annotateCards([updated], "colony", entries)[0]?.merges[0]?.title).toBe("Fresh merge");
		expect(annotateCards([left], "colony", entries)[0]).toBe(left);
	},
);

test.each([
	{ size: 1, refresh: false },
	{ size: 1, refresh: true },
	{ size: SMALL_FAMILY, refresh: false },
	{ size: SMALL_FAMILY, refresh: true },
	{ size: ANNOTATION_BATCH + SMALL_FAMILY, refresh: false },
	{ size: ANNOTATION_BATCH + SMALL_FAMILY, refresh: true },
])(
	"annotation state stays visible for family %j #test-509",
	// eslint-disable-next-line max-statements -- Verify a failed family batch and retained icons together.
	async ({ size, refresh }) => {
		const nodes = Array.from({ length: size }, (_value, index) => node(String(index)));
		const ids = nodes.map((item) => item.id);
		const batch = ids.slice(-SMALL_FAMILY);
		const failed = Promise.withResolvers<CardAnnotations>();
		const resource = createCardAnnotationsResource((path) => {
			if (path === "fail") {
				return failed.promise;
			}
			return Promise.resolve({
				cards: nodes
					.filter((item) => batch.includes(item.id) || path === "first")
					.map((item) => ({
						id: item.id,
						status: item.status,
						assignee: item.assignee,
						updatedAt: item.updatedAt,
						beeAssignments: [{ id: "request", kind: "worker", stdout: null }],
						merges: [],
						sources: { merges: 1, assignments: 1 },
					})),
				fetchedAt: OLD,
			});
		});
		if (refresh) {
			await resource.load(batchKey(ids.slice(0, ANNOTATION_BATCH)), "first");
			await resource.load(batchKey(batch), "ready");
		}
		const pending = resource.load(batchKey(batch), "fail", true);
		const groups = [[ids[0]!], ids];
		expect(annotationStatus("colony", groups, resource.store.getState().entries).kind).toBe(
			"loading",
		);
		failed.reject(new Error("Icons unavailable"));
		await pending;
		const { entries } = resource.store.getState();
		expect(annotationStatus("colony", groups, entries).kind).toBe("failed");
		await resource.load(batchKey(["overlap", ...batch]), "ready", true);
		expect(annotationStatus("colony", groups, resource.store.getState().entries).kind).toBe(
			"failed",
		);
		expect(
			annotateCards(nodes, "colony", entries).every(
				(item) => item.beeAssignments.length === Number(refresh),
			),
		).toBe(true);
		expect(nodes).toHaveLength(size);
		resource.store.setState({
			entries: {
				...entries,
				[batchKey(batch)]: { kind: "stale", data: { cards: [], fetchedAt: OLD } },
			},
		});
		expect(annotationStatus("colony", [ids], resource.store.getState().entries).kind).toBe("stale");
	},
);

test("annotation status distinguishes recovered batches from unread or absent batches", () => {
	const ready = {
		kind: "ready" as const,
		data: { cards: [], fetchedAt: OLD },
		receivedAt: 0,
	};
	const entries = { [batchKey(["left"])]: ready };
	expect(annotationStatus("colony", [["left"]], entries).kind).toBe("ready");
	expect(annotationStatus("colony", [["left"], ["right"]], entries).kind).toBe("empty");
	expect(annotationStatus("colony", [], entries).kind).toBe("empty");
});

// eslint-disable-next-line max-statements -- Keep the in-memory sources and inventory gate together.
async function annotationFixture() {
	const beads = createMemoryBeads();
	const scope = { cwd: colony.root, db: colony.beadsDb, actor: "fixture" };
	const task = await beads.create(scope, { title: "Task" });
	const assigned = await beads.create(scope, {
		title: "Assigned",
		status: "in_progress",
		assignee: "bee",
	});
	const merge = await beads.create(scope, {
		title: "Old merge",
		labels: ["merge"],
		description: JSON.stringify({
			url: "https://github.com/example/repo/pull/1",
			branch: "work",
			resolution: "open",
		}),
	});
	await beads.dep.add(scope, task.id, merge.id, "relates-to");
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const context = {
		colony,
		requestId: "test",
		log: async () => {},
		beads: {
			...beads,
			list: async (...args: Parameters<typeof beads.list>) => {
				const result = await beads.list(...args);
				entered.resolve();
				await release.promise;
				return result;
			},
		},
	};
	const now = Date.now() + 1;
	const data = createBoardData(unrequestedTopology, () => now);
	const warm = await data.annotations(context, [task.id], 0);
	return { beads, scope, merge, task, assigned, context, data, now, warm, entered, release };
}

async function assignmentFixture() {
	const beads = createMemoryBeads();
	const scope = { cwd: colony.root, db: colony.beadsDb, actor: "fixture" };
	const task = await beads.create(scope, { title: "Task", status: "in_progress", assignee: "bee" });
	const request = await beads.create(scope, {
		title: "Request",
		assignee: "bee",
		labels: ["system", "bee", "agent:worker"],
		description: JSON.stringify({ harness: "codex", kind: "worker", model: "gpt-6-astra" }),
	});
	await beads.dep.add(scope, request.id, task.id, "related");
	const context = { beads, colony, requestId: "test", log: async () => {} };
	const now = Date.parse(NEW);
	const data = createBoardData(unrequestedTopology, () => now);
	await data.annotations(context, [task.id], 0);
	return { beads, scope, request, task, context, data, now };
}

function batchKey(ids: string[]): string {
	return annotationKey("colony", ids);
}

function requestedIds(path: string): string[] {
	return z
		.array(z.string())
		.parse(JSON.parse(new URL(path, "http://hive").searchParams.get("ids")!));
}

function annotationData(ids: string[], fetchedAt = NEW): CardAnnotations {
	return {
		cards: ids.map((id) => ({
			...node(id),
			beeAssignments: [{ id: "request", kind: "worker", stdout: null }],
			sources: { merges: 1, assignments: 1 },
		})),
		fetchedAt,
	};
}

function key(ids: string[]): string {
	return hierarchyKey("colony", ids);
}

function node(id: string, parentIds: string[] = []): HierarchyNode {
	return {
		id,
		title: id,
		parentIds,
		status: "open",
		priority: 2,
		assignee: null,
		owner: "ct",
		beeAssignments: [],
		merges: [],
		isWorkflowGenerated: false,
		labels: [],
		updatedAt: OLD,
	};
}

function unrequestedTopology(): Promise<never> {
	throw new Error("Graph must remain lazy");
}
