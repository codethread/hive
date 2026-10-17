import type { BeadsScope, BeadsService, SyncStatus } from "@hive/beads";
import type { Colony } from "../contracts.ts";
import { z } from "zod";

const nodeSchema = z.object({
	id: z.string(),
	status: z.string(),
	labels: z.array(z.string()).default([]),
});
const edgeSchema = z.object({ from: z.string(), to: z.string(), type: z.string() });
const sourceSchema = z.object({ stale: z.boolean(), status: z.string() });
const authoritySchema = z.object({
	state: z.string(),
	loaded: z.number(),
	failed: z.number(),
	errors: z.number(),
	read_errors: z.number(),
	skipped: z.number(),
	sources: z.array(sourceSchema).length(1),
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
		source_authority: authoritySchema,
		adjacency: adjacencySchema.optional(),
		nodes: z.number(),
		edges: z.number(),
	}),
);

export interface Topology {
	/** Exported nodes; tombstones and nonexportable records are excluded. */
	nodes: z.infer<typeof nodeSchema>[];
	/** Native typed links; parent-child edges point from child to parent. */
	edges: z.infer<typeof edgeSchema>[];
	/** Start of this checked source observation, retained when cached. */
	fetchedAt: string;
	/** Native diagnostics or BV mark the readable export as stale. */
	stale: boolean;
}
interface TopologyRead<Value> {
	/** Consumer projection from a validated export. */
	value: Value;
	/** Includes changes observed while the consumer hydrated native rows. */
	stale: boolean;
}
/** Construct a value from a checked export; resolve only after the final source check. */
export type ReadTopology = <Value>(
	colony: Colony,
	consume: (graph: Topology) => Promise<Value>,
) => Promise<TopologyRead<Value>>;
interface TopologyDependencies {
	/** Native source discovery and read-only export diagnostics. */
	beads: BeadsService;
	/** BV subprocess boundary, composed with the server's invocation environment. */
	execute: (argv: string[], cwd: string) => Promise<string>;
}

export function createTopologyReader({ beads, execute }: TopologyDependencies): ReadTopology {
	// eslint-disable-next-line max-statements -- Keep admission and both freshness observations around consumption.
	return async (colony, consume) => {
		const scope: BeadsScope = {
			cwd: colony.root,
			db: colony.beadsDb,
			noAutoImport: true,
			noAutoFlush: true,
		};
		const fetchedAt = new Date().toISOString();
		const [location, before] = await Promise.all([beads.where(scope), beads.sync.status(scope)]);
		assertExportReadable(before);
		const output = await execute(
			["bv", "--db", location.jsonl_path, "--robot-graph", "--graph-format=json"],
			colony.root,
		);
		const graph = parseGraph(output, location.jsonl_path);
		const stale = exportStale(before) || graph.stale;
		const value = await consume({ ...graph, fetchedAt, stale });
		const after = await beads.sync.status(scope);
		assertExportReadable(after);
		return {
			value,
			stale: stale || exportStale(after) || before.jsonl_content_hash !== after.jsonl_content_hash,
		};
	};
}

// --- Private functions ---
function parseGraph(output: string, path: string) {
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
	return { ...adjacency, stale: graph.source_authority.sources.some((source) => source.stale) };
}
function assertGraphSource(graph: z.infer<typeof graphSchema>, path: string): void {
	if (graph.source_path !== path || graph.source_kind !== "jsonl_local") {
		throw new Error("BV read a different export from the selected tracker.");
	}
	const authority = graph.source_authority;
	const stale = authority.sources.some((source) => source.stale);
	if (
		!(authority.state === "complete" || (authority.state === "partial" && stale)) ||
		authority.loaded !== 1 ||
		authority.failed !== 0 ||
		authority.errors !== 0 ||
		authority.read_errors !== 0 ||
		authority.skipped !== 0 ||
		authority.sources.some((source) => source.status !== "loaded")
	) {
		throw new Error("BV could not read a complete export. Check its source and refresh hierarchy.");
	}
}
function assertExportReadable(status: SyncStatus): void {
	if (
		!status.jsonl_exists ||
		status.jsonl_content_hash === null ||
		(status.workspace_health !== "healthy" && status.workspace_health !== "degraded")
	) {
		throw new Error(
			"The Beads export is missing or unhealthy. Complete its export, then refresh hierarchy.",
		);
	}
}
function exportStale(status: SyncStatus): boolean {
	return (
		status.dirty_count !== 0 ||
		status.db_newer ||
		status.jsonl_newer ||
		status.coverage_drift ||
		status.workspace_health === "degraded"
	);
}
