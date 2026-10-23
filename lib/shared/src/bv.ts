import { execute as executeNative } from "./bees-io.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
// BV accepts only a positive map limit; use its portable signed-integer maximum.
const INSIGHTS_MAP_LIMIT = "2147483647";
const rankingSourceSchema = z.object({
	errors: z.literal(ZERO),
	read_errors: z.literal(ZERO),
	skipped: z.literal(ZERO),
	source_kind: z.literal("sqlite"),
	source_path: z.string(),
	stale: z.literal(false),
	status: z.literal("loaded"),
	valid: z.number().int(),
	visible: z.number().int().nonnegative(),
});
const scoresSchema = z.record(z.string(), z.number().finite().nonnegative());
const pageRankStatusSchema = z.object({ state: z.literal("computed") });
const rankingAuthoritySchema = z.object({
	errors: z.literal(ZERO),
	failed: z.literal(ZERO),
	read_errors: z.literal(ZERO),
	skipped: z.literal(ZERO),
	sources: z.array(rankingSourceSchema).length(ONE),
	state: z.literal("complete"),
});
const insightsSchema = z.compile(
	z.object({
		full_stats: z.object({ pagerank: scoresSchema }),
		source_authority: rankingAuthoritySchema,
		status: z.object({ PageRank: pageRankStatusSchema }),
	}),
);
const nodeSchema = z.object({
	id: z.string(),
	status: z.string(),
	labels: z.array(z.string()).default([]),
});
const edgeSchema = z.object({ from: z.string(), to: z.string(), type: z.string() });
const graphSourceSchema = z.object({ stale: z.boolean(), status: z.string() });
const graphAuthoritySchema = z.object({
	state: z.string(),
	loaded: z.number(),
	failed: z.number(),
	errors: z.number(),
	read_errors: z.number(),
	skipped: z.number(),
	sources: z.array(graphSourceSchema).length(ONE),
});
const adjacencySchema = z.object({
	nodes: z.array(nodeSchema),
	edges: z
		.array(edgeSchema)
		.nullable()
		.transform((edges) => edges ?? []),
});
const graphSchema = z.compile(
	z.object({
		source_path: z.string(),
		source_kind: z.string(),
		source_authority: graphAuthoritySchema,
		adjacency: adjacencySchema.optional(),
		nodes: z.number(),
		edges: z.number(),
	}),
);

export interface BvGraph {
	/** Exported nodes; tombstones and nonexportable records are excluded by native BV. */
	nodes: { id: string; status: string; labels: string[] }[];
	/** Native typed links; parent-child edges point from child to parent. */
	edges: { from: string; to: string; type: string }[];
	/** BV marks the selected readable export as stale. */
	sourceStale: boolean;
}
export interface BvService {
	/** Read scores for the complete visible graph from the selected SQLite database. */
	readPageRanks: (input: { cwd: string; sqlitePath: string }) => Promise<Record<string, number>>;
	/** Read a complete graph from the selected JSONL export, retaining source staleness. */
	readGraph: (input: { cwd: string; jsonlPath: string }) => Promise<BvGraph>;
}
interface NativeBvOptions {
	/** Subprocess boundary; native command failures propagate unchanged. */
	execute?: typeof executeNative;
	/** Invocation environment, copied before applying operation-specific overrides. */
	env?: NodeJS.ProcessEnv;
}
interface FakeBvOptions {
	/** IDs to rank alphabetically, independently of graph topology. */
	taskIds?: readonly string[];
	/** Graph snapshot to return without native source validation. */
	graph?: BvGraph;
}

/** Owns BV command translation and validation, not scheduling or export synchronization. */
export function createNativeBv({
	execute = executeNative,
	env = process.env,
}: NativeBvOptions = {}): BvService {
	const environment = { ...env };
	return {
		readPageRanks: async ({ cwd, sqlitePath }) => {
			const output = await execute(
				["bv", "--robot-insights", "--force-full-analysis", "--db", sqlitePath, "--format", "json"],
				cwd,
				{ ...environment, BV_INSIGHTS_MAP_LIMIT: INSIGHTS_MAP_LIMIT },
			);
			return parsePageRanks(output, sqlitePath);
		},
		readGraph: async ({ cwd, jsonlPath }) => {
			const output = await execute(
				["bv", "--db", jsonlPath, "--robot-graph", "--graph-format=json"],
				cwd,
				{ ...environment },
			);
			return parseGraph(output, jsonlPath);
		},
	};
}

/**
 * Deliberately simple test fake: earlier lexicographic IDs get higher positive scores.
 * Ignores cwd/source paths, does no I/O and does not emulate BV's PageRank algorithm
 * or source validation. Seed data and returned snapshots are isolated from callers.
 */
export function createFakeBv({ taskIds = [], graph }: FakeBvOptions = {}): BvService {
	const ids = [...new Set(taskIds)].toSorted();
	const scores = Object.fromEntries(ids.map((id, index) => [id, ids.length - index]));
	const snapshot = structuredClone(graph ?? { nodes: [], edges: [], sourceStale: false });
	return {
		readPageRanks: () => Promise.resolve({ ...scores }),
		readGraph: () => Promise.resolve(structuredClone(snapshot)),
	};
}

// --- Private functions ---
function parsePageRanks(output: string, path: string): Record<string, number> {
	const insights = insightsSchema.parse(JSON.parse(output));
	const [source] = insights.source_authority.sources;
	if (source!.source_path !== path) {
		throw new Error("BV ranking did not read the selected tracker database");
	}
	const scores = insights.full_stats.pagerank;
	if (Object.keys(scores).length !== source!.visible) {
		throw new Error("BV ranking did not return scores for the complete visible graph");
	}
	return scores;
}
function parseGraph(output: string, path: string): BvGraph {
	const graph = graphSchema.parse(JSON.parse(output));
	assertGraphSource(graph, path);
	const adjacency = graph.adjacency ?? { nodes: [], edges: [] };
	if (adjacency.nodes.length !== graph.nodes || adjacency.edges.length !== graph.edges) {
		throw new Error("BV returned an incomplete graph.");
	}
	const ids = new Set(adjacency.nodes.map((node) => node.id));
	if (
		ids.size !== adjacency.nodes.length ||
		adjacency.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))
	) {
		throw new Error("BV returned duplicate or missing graph endpoints.");
	}
	return {
		...adjacency,
		sourceStale: graph.source_authority.sources.some((source) => source.stale),
	};
}
function assertGraphSource(graph: z.infer<typeof graphSchema>, path: string): void {
	if (graph.source_path !== path || graph.source_kind !== "jsonl_local") {
		throw new Error("BV read a different export from the selected tracker.");
	}
	const authority = graph.source_authority;
	const stale = authority.sources.some((source) => source.stale);
	if (
		!(authority.state === "complete" || (authority.state === "partial" && stale)) ||
		authority.loaded !== ONE ||
		authority.failed !== ZERO ||
		authority.errors !== ZERO ||
		authority.read_errors !== ZERO ||
		authority.skipped !== ZERO ||
		authority.sources.some((source) => source.status !== "loaded")
	) {
		throw new Error("BV could not read a complete export. Check its source and refresh hierarchy.");
	}
}
