import { createFakeBv, createNativeBv } from "./bv.ts";
import { expect, test } from "bun:test";
import type { BvGraph } from "./bv.ts";

const FIRST = 0;
const ZERO = 0;
const sqlitePath = "/tracker/selected.db";
const jsonlPath = "/exports/selected.jsonl";
const rankingInput = { cwd: "/neutral", sqlitePath };
const graphInput = { cwd: "/repository", jsonlPath };
const insights = {
	full_stats: { pagerank: { first: 0.75, second: 0 } },
	source_authority: {
		errors: 0,
		failed: 0,
		read_errors: 0,
		skipped: 0,
		state: "complete",
		sources: [
			{
				errors: 0,
				read_errors: 0,
				skipped: 0,
				source_kind: "sqlite",
				source_path: sqlitePath,
				stale: false,
				status: "loaded",
				valid: 2,
				visible: 2,
			},
		],
	},
	status: { PageRank: { state: "computed" } },
};
const graph = {
	source_path: jsonlPath,
	source_kind: "jsonl_local",
	source_authority: {
		state: "complete",
		loaded: 1,
		failed: 0,
		errors: 0,
		read_errors: 0,
		skipped: 0,
		sources: [{ stale: false, status: "loaded" }],
	},
	nodes: 2,
	edges: 1,
	adjacency: {
		nodes: [
			{ id: "child", status: "open", labels: ["work"] },
			{ id: "parent", status: "closed" },
		],
		edges: [{ from: "child", to: "parent", type: "parent-child" }],
	},
};
const snapshot: BvGraph = {
	nodes: [
		{ id: "child", status: "open", labels: ["work"] },
		{ id: "parent", status: "closed", labels: [] },
	],
	edges: [{ from: "child", to: "parent", type: "parent-child" }],
	sourceStale: false,
};

// eslint-disable-next-line max-statements -- Observe both commands and isolated operation environments together.
test("native reads construct their exact commands without leaking environment overrides #test-671", async () => {
	const calls: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
	const env = { PATH: "/bin", BEADS_DB: "/ambient.db", BV_INSIGHTS_MAP_LIMIT: "1" };
	const bv = createNativeBv({
		env,
		execute: (argv, cwd, environment) => {
			calls.push({ argv, cwd, env: { ...environment } });
			environment.PATH = "/changed-by-executor";
			let payload = JSON.stringify(graph);
			if (argv.includes("--robot-insights")) {
				payload = JSON.stringify(insights);
			}
			return Promise.resolve(payload);
		},
	});
	expect(await bv.readPageRanks(rankingInput)).toEqual(insights.full_stats.pagerank);
	expect(await bv.readGraph(graphInput)).toEqual(snapshot);
	expect(calls).toEqual([
		{
			argv: [
				"bv",
				"--robot-insights",
				"--force-full-analysis",
				"--db",
				sqlitePath,
				"--format",
				"json",
			],
			cwd: rankingInput.cwd,
			env: { ...env, BV_INSIGHTS_MAP_LIMIT: "2147483647" },
		},
		{
			argv: ["bv", "--db", jsonlPath, "--robot-graph", "--graph-format=json"],
			cwd: graphInput.cwd,
			env,
		},
	]);
	expect(env.PATH).toBe("/bin");
	expect(env.BV_INSIGHTS_MAP_LIMIT).toBe("1");
});

test.each(["readPageRanks", "readGraph"] as const)(
	"native %s propagates execution failures without a fake fallback",
	async (operation) => {
		const failure = new Error("native process failed");
		const bv = createNativeBv({
			env: {},
			execute: () => Promise.reject(failure),
		});
		const result = await bv[operation]({ ...rankingInput, ...graphInput }).catch(
			(error: unknown) => error,
		);
		expect(result).toBe(failure);
	},
);

test.each([
	{ name: "invalid JSON", output: "{" },
	{ name: "missing protocol", output: "{}" },
	{ name: "missing scores", output: JSON.stringify({ ...insights, full_stats: {} }) },
	{
		name: "uncomputed metric",
		output: JSON.stringify({ ...insights, status: { PageRank: { state: "timeout" } } }),
	},
	{
		name: "truncated score map",
		output: JSON.stringify({ ...insights, full_stats: { pagerank: { first: 0.75 } } }),
	},
	{
		name: "negative score",
		output: JSON.stringify({ ...insights, full_stats: { pagerank: { first: -1, second: 0 } } }),
	},
	{
		name: "non-finite score",
		output: JSON.stringify(insights).replace("0.75", "1e400"),
	},
])("PageRank rejects $name #test-670", async ({ output }) => {
	const bv = nativeFixture(output);
	await expect(bv.readPageRanks(rankingInput)).rejects.toBeInstanceOf(Error);
});

test.each([
	{ state: "partial" },
	{ errors: 1 },
	{ failed: 1 },
	{ read_errors: 1 },
	{ skipped: 1 },
	{ sources: [] },
	{ sources: [...insights.source_authority.sources, ...insights.source_authority.sources] },
])("PageRank refuses incomplete source authority: %j", async (change) => {
	const bv = nativeFixture({
		...insights,
		source_authority: { ...insights.source_authority, ...change },
	});
	await expect(bv.readPageRanks(rankingInput)).rejects.toBeInstanceOf(Error);
});

test.each([
	{ errors: 1 },
	{ read_errors: 1 },
	{ skipped: 1 },
	{ source_kind: "jsonl_local" },
	{ source_path: "/different.db" },
	{ stale: true },
	{ status: "failed" },
	{ visible: 3 },
])("PageRank refuses wrong, stale or incomplete SQLite input: %j", async (change) => {
	const bv = nativeFixture({
		...insights,
		source_authority: {
			...insights.source_authority,
			sources: [{ ...insights.source_authority.sources[FIRST], ...change }],
		},
	});
	await expect(bv.readPageRanks(rankingInput)).rejects.toBeInstanceOf(Error);
});

test("PageRank accepts a complete empty graph without requiring caller task IDs", async () => {
	const bv = nativeFixture({
		...insights,
		full_stats: { pagerank: {} },
		source_authority: {
			...insights.source_authority,
			sources: [{ ...insights.source_authority.sources[FIRST], valid: 0, visible: 0 }],
		},
	});
	expect(await bv.readPageRanks(rankingInput)).toEqual({});
});

test.each([
	{ state: "complete", stale: false },
	{ state: "complete", stale: true },
	{ state: "partial", stale: true },
])("graph retains source staleness with $state authority and stale=$stale", async (source) => {
	const bv = nativeFixture({
		...graph,
		source_authority: {
			...graph.source_authority,
			state: source.state,
			sources: [{ status: "loaded", stale: source.stale }],
		},
	});
	expect(await bv.readGraph(graphInput)).toEqual({ ...snapshot, sourceStale: source.stale });
});

test.each([
	{ state: "partial", sources: [{ stale: false, status: "loaded" }] },
	{ state: "unknown" },
	{ loaded: 0 },
	{ failed: 1 },
	{ errors: 1 },
	{ read_errors: 1 },
	{ skipped: 1 },
	{ sources: [] },
	{ sources: [{ stale: true, status: "failed" }] },
	{ sources: [...graph.source_authority.sources, ...graph.source_authority.sources] },
])("graph refuses unusable authority even when stale: %j #test-665", async (change) => {
	const bv = nativeFixture({
		...graph,
		source_authority: {
			...graph.source_authority,
			state: "partial",
			sources: [{ stale: true, status: "loaded" }],
			...change,
		},
	});
	await expect(bv.readGraph(graphInput)).rejects.toBeInstanceOf(Error);
});

test.each([
	{ name: "invalid JSON", output: "{" },
	{ name: "missing protocol", output: "{}" },
	{ name: "wrong export", output: { ...graph, source_path: "/different.jsonl" } },
	{ name: "wrong source kind", output: { ...graph, source_kind: "sqlite" } },
	{ name: "missing adjacency", output: { ...graph, adjacency: undefined } },
	{ name: "node count mismatch", output: { ...graph, nodes: 3 } },
	{ name: "edge count mismatch", output: { ...graph, edges: 2 } },
	{
		name: "duplicate node IDs",
		output: {
			...graph,
			adjacency: {
				...graph.adjacency,
				nodes: [graph.adjacency.nodes[FIRST], graph.adjacency.nodes[FIRST]],
			},
		},
	},
	{
		name: "missing dependency endpoint",
		output: {
			...graph,
			adjacency: {
				...graph.adjacency,
				edges: [{ from: "child", to: "missing", type: "blocks" }],
			},
		},
	},
	{
		name: "missing dependent endpoint",
		output: {
			...graph,
			adjacency: {
				...graph.adjacency,
				edges: [{ from: "missing", to: "parent", type: "blocks" }],
			},
		},
	},
])("graph rejects $name", async ({ output }) => {
	await expect(nativeFixture(output).readGraph(graphInput)).rejects.toBeInstanceOf(Error);
});

test.each([
	{ ...graph, nodes: 0, edges: 0, adjacency: undefined },
	{ ...graph, nodes: 0, edges: 0, adjacency: { nodes: [], edges: JSON.parse("null") } },
])("graph accepts native empty adjacency encodings: %j #test-707", async (output) => {
	expect(await nativeFixture(output).readGraph(graphInput)).toEqual({
		nodes: [],
		edges: [],
		sourceStale: false,
	});
});

test("fake ranks unique IDs lexicographically, not by topology or source paths", async () => {
	const taskIds = ["zebra", "banana", "apple", "banana"];
	const bv = createFakeBv({ taskIds, graph: snapshot });
	taskIds.push("0");
	const ranks = await bv.readPageRanks(rankingInput);
	expect(ranks).toEqual({ apple: 3, banana: 2, zebra: 1 });
	expect(Object.values(ranks).every((score) => Number.isFinite(score) && score > ZERO)).toBe(true);
	ranks.apple = ZERO;
	expect(await bv.readPageRanks({ cwd: "/ignored", sqlitePath: "/missing.db" })).toEqual({
		apple: 3,
		banana: 2,
		zebra: 1,
	});
	expect(
		await createFakeBv({ taskIds: ["banana", "zebra", "apple"] }).readPageRanks(rankingInput),
	).toEqual({
		apple: 3,
		banana: 2,
		zebra: 1,
	});
});

// eslint-disable-next-line max-statements -- Mutate each nested seed/result location to prove snapshot isolation.
test("fake graph snapshots isolate seed data, results and separate instances", async () => {
	const seed = structuredClone(snapshot);
	const bv = createFakeBv({ graph: seed });
	seed.nodes[FIRST]!.labels.push("seed mutation");
	seed.edges[FIRST]!.type = "related";
	seed.sourceStale = true;
	const first = await bv.readGraph(graphInput);
	expect(first).toEqual(snapshot);
	first.nodes[FIRST]!.status = "closed";
	first.nodes[FIRST]!.labels.push("result mutation");
	first.nodes.pop();
	first.edges[FIRST]!.to = "changed";
	first.edges.push({ from: "child", to: "child", type: "related" });
	first.sourceStale = true;
	expect(await bv.readGraph({ cwd: "/ignored", jsonlPath: "/missing.jsonl" })).toEqual(snapshot);
	expect(await createFakeBv().readGraph(graphInput)).toEqual({
		nodes: [],
		edges: [],
		sourceStale: false,
	});
	expect(await createFakeBv().readPageRanks(rankingInput)).toEqual({});
});

function nativeFixture(output: unknown) {
	return createNativeBv({
		env: {},
		execute: () => {
			if (typeof output === "string") {
				return Promise.resolve(output);
			}
			return Promise.resolve(JSON.stringify(output));
		},
	});
}
