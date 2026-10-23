import type { BeadsScope, BeadsService, SyncStatus } from "@hive/beads";
import type { BvGraph, BvService } from "@hive/shared/bv";
import type { Colony } from "../contracts.ts";

export interface Topology {
	/** Exported nodes; tombstones and nonexportable records are excluded. */
	nodes: BvGraph["nodes"];
	/** Native typed links; parent-child edges point from child to parent. */
	edges: BvGraph["edges"];
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
	/** Typed exported graph reader, composed at server startup. */
	bv: Pick<BvService, "readGraph">;
}

export function createTopologyReader({ beads, bv }: TopologyDependencies): ReadTopology {
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
		const { nodes, edges, sourceStale } = await bv.readGraph({
			cwd: colony.root,
			jsonlPath: location.jsonl_path,
		});
		const stale = exportStale(before) || sourceStale;
		const value = await consume({ nodes, edges, fetchedAt, stale });
		const after = await beads.sync.status(scope);
		assertExportReadable(after);
		return {
			value,
			stale: stale || exportStale(after) || before.jsonl_content_hash !== after.jsonl_content_hash,
		};
	};
}

// --- Private functions ---
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
