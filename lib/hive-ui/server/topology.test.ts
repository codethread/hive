import type { BeadsScope, SyncStatus } from "@hive/beads";
import { expect, test } from "bun:test";
import type { Topology } from "./topology.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createMemoryBeads } from "@hive/beads";
import { createTopologyReader } from "./topology.ts";

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
const output = {
	source_path: path,
	source_kind: "jsonl_local",
	source_authority: {
		state: "complete",
		errors: 0,
		read_errors: 0,
		skipped: 0,
		sources: [{ stale: false }],
	},
	nodes: 1,
	edges: 0,
	adjacency: { nodes: [{ id: "root", status: "closed" }], edges: null },
};

test("graph reads pin the native-selected export and retain the source observation", async () => {
	const fixture = readerFixture([healthy, healthy], output);
	const graph = await fixture.reader(colony, (value) => Promise.resolve(value));
	expect(graph.nodes).toEqual([{ id: "root", status: "closed", labels: [] }]);
	expect(graph.edges).toEqual([]);
	expect(fixture.calls).toEqual([["bv", "--db", path, "--robot-graph", "--graph-format=json"]]);
	expect(fixture.scopes).toEqual([
		{
			cwd: colony.root,
			db: colony.beadsDb,
			actor: "hive-ui",
			noAutoImport: true,
			noAutoFlush: true,
		},
	]);
});

test.each([
	{ dirty_count: 1 },
	{ db_newer: true },
	{ jsonl_newer: true },
	{ jsonl_exists: false },
	{ jsonl_content_hash: null },
	{ coverage_drift: true },
	{ workspace_health: "unhealthy" },
])("unavailable native export rejects before graph consumption: %j", async (change) => {
	const fixture = readerFixture([{ ...healthy, ...change }], output);
	const result = await fixture.reader(colony, consumeGraph).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(fixture.calls).toEqual([]);
});

test.each([
	{ ...healthy, jsonl_content_hash: "changed" },
	{ ...healthy, dirty_count: 1, db_newer: true },
])("a source change during row hydration rejects its result: %j", async (after) => {
	const fixture = readerFixture([healthy, after], output);
	let consumed = false;
	const value = Promise.resolve("rows");
	const result = await fixture
		.reader(colony, () => {
			consumed = true;
			return value;
		})
		.catch((error: unknown) => error);
	expect(consumed).toBe(true);
	expect(result).toBeInstanceOf(Error);
});

test.each([
	{ ...output, source_path: "/different.jsonl" },
	{ ...output, source_kind: "sqlite" },
	{ ...output, source_authority: { ...output.source_authority, state: "partial", errors: 1 } },
	{ ...output, source_authority: { ...output.source_authority, sources: [{ stale: true }] } },
	{
		...output,
		edges: 1,
		adjacency: {
			...output.adjacency,
			edges: [{ from: "root", to: "missing", type: "parent-child" }],
		},
	},
])("partial or mismatched graph source cannot publish a hierarchy: %j", async (payload) => {
	const fixture = readerFixture([healthy], payload);
	const result = await fixture.reader(colony, consumeGraph).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
});

function consumeGraph(graph: Topology): Promise<Topology> {
	return Promise.resolve(graph);
}

function readerFixture(statuses: SyncStatus[], payload: object) {
	const calls: string[][] = [];
	const scopes: BeadsScope[] = [];
	const memory = createMemoryBeads();
	let index = 0;
	const reader = createTopologyReader({
		beads: {
			...memory,
			where: (scope) => {
				scopes.push(scope);
				return Promise.resolve({ database_path: colony.beadsDb, jsonl_path: path });
			},
			sync: { ...memory.sync, status: () => Promise.resolve(statuses[index++]!) },
		},
		execute: (argv) => {
			calls.push(argv);
			return Promise.resolve(JSON.stringify(payload));
		},
	});
	return { reader, calls, scopes };
}
