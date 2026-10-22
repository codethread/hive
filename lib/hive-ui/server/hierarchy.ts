import type { ProjectedBead } from "@hive/beads";
import type { Topology } from "./topology.ts";

export const SUMMARY_FIELDS = [
	"id",
	"title",
	"status",
	"priority",
	"assignee",
	"owner",
	"updated_at",
	"labels",
	"dependency_count",
	"dependent_count",
] as const;
export type SummaryBead = ProjectedBead<typeof SUMMARY_FIELDS>;

const READ_BATCH = 500;
const EXCLUDED_LABELS = new Set(["system", "bee", "merge"]);

export interface HierarchyRecord {
	/** Native card fields, independent of the exported graph. */
	bead: SummaryBead;
	/** Parent-child links from the checked BV export. */
	parentIds: string[];
}
interface HierarchyReads {
	/** Complete exported topology for this read. */
	graph: Topology;
	/** Native summaries for explicit IDs, including closed records and templates. */
	rows: (ids: string[]) => Promise<SummaryBead[]>;
}
interface FamilyIndex {
	/** Exported ordinary task identities. */
	nodes: Set<string>;
	/** Outgoing native parent-child links. */
	parents: Map<string, string[]>;
	/** Incoming native parent-child links. */
	children: Map<string, string[]>;
}

/** Select ordinary families from the exported graph, then hydrate native card fields. */
export async function readHierarchy(
	ids: string[],
	{ graph, rows }: HierarchyReads,
	direction: "family" | "descendants",
): Promise<HierarchyRecord[]> {
	const index = indexGraph(graph);
	let seeds = ids;
	if (graph.stale) {
		seeds = ids.filter((id) => index.nodes.has(id));
	}
	const members = familyMembers(seeds, index, direction);
	const records: HierarchyRecord[] = [];
	/* eslint-disable no-await-in-loop -- Bounded native batches hydrate the discovered component. */
	for (let offset = 0; offset < members.length; offset += READ_BATCH) {
		const batch = members.slice(offset, offset + READ_BATCH);
		records.push(...(await hydrateBatch(batch, rows, index.parents)));
	}
	/* eslint-enable no-await-in-loop */
	return records;
}

// --- Private functions ---
function indexGraph(graph: Topology): FamilyIndex {
	const nodes = new Set(
		graph.nodes
			.filter(
				(node) =>
					node.status !== "tombstone" && !node.labels.some((label) => EXCLUDED_LABELS.has(label)),
			)
			.map((node) => node.id),
	);
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (edge.type === "parent-child" && nodes.has(edge.from) && nodes.has(edge.to)) {
			parents.set(edge.from, [...(parents.get(edge.from) ?? []), edge.to]);
			children.set(edge.to, [...(children.get(edge.to) ?? []), edge.from]);
		}
	}
	return { nodes, parents, children };
}

// eslint-disable-next-line max-statements -- Keep seed validation and finite graph traversal together.
function familyMembers(
	ids: string[],
	index: FamilyIndex,
	direction: "family" | "descendants",
): string[] {
	for (const id of ids) {
		if (!index.nodes.has(id)) {
			throw new Error(
				`Bead ${id} is absent from the exported ordinary-task graph. ` +
					"Hierarchy requires an exported, non-tombstone ordinary task.",
			);
		}
	}
	const visited = new Set<string>();
	const pending = [...ids];
	for (const id of pending) {
		if (!visited.has(id)) {
			visited.add(id);
			pending.push(...(index.children.get(id) ?? []));
			if (direction === "family") {
				pending.push(...(index.parents.get(id) ?? []));
			}
		}
	}
	return [...visited];
}

async function hydrateBatch(
	ids: string[],
	rows: HierarchyReads["rows"],
	parents: Map<string, string[]>,
): Promise<HierarchyRecord[]> {
	const selected = await rows(ids);
	const summaries = new Map(selected.map((row) => [row.id, row]));
	return ids.map((id) => {
		const bead = summaries.get(id);
		if (!bead || bead.status === "tombstone") {
			throw new Error(`Bead ${id} disappeared while loading hierarchy. Refresh to reload.`);
		}
		return { bead, parentIds: parents.get(id) ?? [] };
	});
}
