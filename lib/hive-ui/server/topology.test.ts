import type { BeadsScope, SyncStatus } from "@hive/beads";
import type { BvGraph, BvService } from "@hive/shared/bv";
import { expect, test } from "bun:test";
import type { Topology } from "./topology.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createFakeBv } from "@hive/shared/bv";
import { createMemoryBeads } from "@hive/beads";
import { createTopologyReader } from "./topology.ts";

const SOURCE_OBSERVATIONS = 3;
const path = "/exports/selected.jsonl";
const healthy: SyncStatus = {
	dirty_count: 0,
	db_newer: false,
	jsonl_content_hash: "original",
	coverage_drift: false,
	jsonl_exists: true,
	jsonl_newer: false,
	workspace_health: "healthy",
};
const graph: BvGraph = {
	nodes: [{ id: "root", status: "closed", labels: [] }],
	edges: [],
	sourceStale: false,
};

test("graph reads select the native export and bracket hydration with read-only observations", async () => {
	const fixture = readerFixture([healthy, healthy]);
	const result = await fixture.reader(colony, consumeGraph);
	expect(fixture.calls).toEqual([{ cwd: colony.root, jsonlPath: path }]);
	expect(fixture.scopes).toEqual(
		Array.from({ length: SOURCE_OBSERVATIONS }, () => ({
			cwd: colony.root,
			db: colony.beadsDb,
			noAutoImport: true,
			noAutoFlush: true,
		})),
	);
	expect(result.value.nodes).toEqual(graph.nodes);
	expect(result.stale).toBe(false);
});

test.each([
	{ jsonl_exists: false },
	{ jsonl_content_hash: null },
	{ workspace_health: "unhealthy" },
])("unavailable native export rejects before graph consumption: %j", async (change) => {
	const fixture = readerFixture([{ ...healthy, ...change }]);
	const result = await fixture.reader(colony, consumeGraph).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(fixture.calls).toEqual([]);
});

test.each([
	{ db_newer: true },
	{ jsonl_newer: true },
	{ coverage_drift: true },
	{ db_newer: true, dirty_count: 1, workspace_health: "degraded" },
])("export lag still consumes the readable graph: %j", async (change) => {
	const fixture = readerFixture([{ ...healthy, ...change }, healthy]);
	const result = await fixture.reader(colony, consumeGraph);
	expect(result.stale).toBe(true);
	expect(result.value.stale).toBe(true);
	expect(result.value.nodes.map((node) => node.id)).toEqual(["root"]);
});

test("BV source staleness contributes to UI freshness", async () => {
	const fixture = readerFixture([healthy, healthy], { ...graph, sourceStale: true });
	const result = await fixture.reader(colony, consumeGraph);
	expect(result.stale).toBe(true);
	expect(result.value.stale).toBe(true);
});

test.each([
	{ ...healthy, jsonl_content_hash: "changed" },
	{ ...healthy, dirty_count: 1, db_newer: true },
	{ ...healthy, jsonl_newer: true },
	{ ...healthy, coverage_drift: true },
])("a source change during row hydration returns usable stale data: %j", async (after) => {
	const fixture = readerFixture([healthy, after]);
	let consumed = false;
	const result = await fixture.reader(colony, () => {
		consumed = true;
		return Promise.resolve("rows");
	});
	expect(consumed).toBe(true);
	expect(result).toEqual({ value: "rows", stale: true });
});

test("unreadable export after hydration rejects publication", async () => {
	const fixture = readerFixture([healthy, { ...healthy, jsonl_exists: false }]);
	const result = await fixture.reader(colony, consumeGraph).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(fixture.scopes).toHaveLength(SOURCE_OBSERVATIONS);
});

test("graph read failures propagate without consuming native rows", async () => {
	const fixture = readerFixture([healthy]);
	const failure = new Error("fixture graph failure");
	fixture.bv.readGraph = () => Promise.reject(failure);
	let consumed = false;
	const rows = Promise.resolve("rows");
	const result = await fixture
		.reader(colony, () => {
			consumed = true;
			return rows;
		})
		.catch((error: unknown) => error);
	expect(result).toBe(failure);
	expect(consumed).toBe(false);
});

function consumeGraph(topology: Topology): Promise<Topology> {
	return Promise.resolve(topology);
}

function readerFixture(statuses: SyncStatus[], snapshot: BvGraph = graph) {
	const calls: Parameters<BvService["readGraph"]>[0][] = [];
	const scopes: BeadsScope[] = [];
	const memory = createMemoryBeads();
	const fake = createFakeBv({ graph: snapshot });
	const bv = {
		...fake,
		readGraph: (input: Parameters<BvService["readGraph"]>[0]) => {
			calls.push(input);
			return fake.readGraph(input);
		},
	};
	let index = 0;
	const reader = createTopologyReader({
		beads: {
			...memory,
			where: (scope) => {
				scopes.push(scope);
				return Promise.resolve({ database_path: colony.beadsDb, jsonl_path: path });
			},
			sync: {
				...memory.sync,
				status: (scope) => {
					scopes.push(scope);
					return Promise.resolve(statuses[index++]!);
				},
			},
		},
		bv,
	});
	return { reader, bv, calls, scopes };
}
