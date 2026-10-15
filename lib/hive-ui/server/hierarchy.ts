import type { DependencyEdge, SelectedBead } from "@hive/beads";

const READ_BATCH = 100;
const EDGE_CONCURRENCY = 4;
export interface HierarchyRecord {
	/** Unhydrated native fields; comments and relationship bodies are not read. */
	bead: SelectedBead;
	/** Native parent links, independent of board filters. */
	parentIds: string[];
}
interface HierarchyReads {
	/** Batch summaries for explicit IDs, including every status. */
	rows: (ids: string[]) => Promise<SelectedBead[]>;
	/** Only native parent-child edges, in both directions. */
	edges: (id: string) => Promise<DependencyEdge[]>;
}

/** Traverse complete ordinary families with bounded native concurrency, without reading comments. */
// Each frontier discovers the next explicit native links; publish only a complete traversal.
// eslint-disable-next-line max-statements
export async function readHierarchy(
	ids: string[],
	reads: HierarchyReads,
	direction: "family" | "descendants",
): Promise<HierarchyRecord[]> {
	const records = new Map<string, HierarchyRecord>();
	const visited = new Set<string>();
	const knownEdges = new Map<string, DependencyEdge>();
	let pending = [...new Set(ids)];
	/* eslint-disable no-await-in-loop -- Each bounded frontier depends on the native edges read before it. */
	while (pending.length > 0) {
		const batch = pending.splice(0, READ_BATCH);
		const rows = await reads.rows(batch);
		const byId = new Map(rows.map((row) => [row.id, row]));
		for (const id of batch) {
			if (!byId.has(id)) {
				throw new Error(`Bead ${id} disappeared while loading hierarchy. Refresh to reload.`);
			}
			visited.add(id);
		}
		const ordinary = rows.filter(
			(row) =>
				!row.labels.includes("system") &&
				!row.labels.includes("bee") &&
				!row.labels.includes("merge"),
		);
		for (let offset = 0; offset < ordinary.length; offset += EDGE_CONCURRENCY) {
			const group = ordinary.slice(offset, offset + EDGE_CONCURRENCY);
			const edges = await Promise.all(
				group.map((row) => {
					const known = [...knownEdges.values()].filter(
						(edge) => edge.issue_id === row.id || edge.depends_on_id === row.id,
					);
					// All native edges are already known: this avoids querying closed leaf descendants and isolated beads.
					if (
						known.filter((edge) => edge.issue_id === row.id).length === row.dependency_count &&
						known.filter((edge) => edge.depends_on_id === row.id).length === row.dependent_count
					) {
						// The aggregator accepts both known and asynchronously read edges as promises.
						// eslint-disable-next-line promise/no-return-wrap
						return Promise.resolve(known);
					}
					return reads.edges(row.id);
				}),
			);
			for (const edge of edges.flat()) {
				knownEdges.set(`${edge.issue_id}/${edge.depends_on_id}`, edge);
			}
			for (const [index, bead] of group.entries()) {
				const parents = edges[index]!.filter((edge) => edge.issue_id === bead.id).map(
					(edge) => edge.depends_on_id,
				);
				const children = edges[index]!.filter((edge) => edge.depends_on_id === bead.id).map(
					(edge) => edge.issue_id,
				);
				records.set(bead.id, { bead, parentIds: parents });
				pending.push(...children);
				if (direction === "family") {
					pending.push(...parents);
				}
			}
		}
		pending = [...new Set(pending)].filter((id) => !visited.has(id));
	}
	/* eslint-enable no-await-in-loop */
	for (const id of ids) {
		if (!records.has(id)) {
			throw new Error(`Bead ${id} is not an ordinary task.`);
		}
	}
	return [...records.values()];
}
