import type { Board, Card, Hierarchy, HierarchyNode } from "./contracts.ts";

export interface BranchRow {
	/** Original native bead summary. */
	node: HierarchyNode;
	/** Displayed distance from the root; board grouping also includes dotted-ID ancestry. */
	depth: number;
}
const RAIL_DESCENDANT_MAXIMUM = 3;

export interface BeadFamily {
	/** Highest loaded ancestor in this connected branch. */
	root: HierarchyNode;
	/** Complete branch in parent-before-child order, including the root. */
	rows: BranchRow[];
}

/** Build adjacency once for a complete read; renderers retain native ordering. */
export function hierarchyChildren(hierarchy: Hierarchy): Map<string, HierarchyNode[]> {
	return childIndex(hierarchy.nodes, nativeParents(hierarchy));
}

export function branchRows(hierarchy: Hierarchy, root: HierarchyNode): BranchRow[] {
	return walkBranch(hierarchyChildren(hierarchy), root, new Set());
}

/** Connected native components remain complete even with multiple parents or cyclic imported data. */
export function beadFamilies(hierarchy: Hierarchy): BeadFamily[] {
	return groupFamilies(hierarchy, nativeParents(hierarchy));
}

export function unclosed(node: HierarchyNode): boolean {
	return node.status !== "closed" && node.status !== "tombstone";
}

/**
 * Hide workflow beads before closed-only branches, always retaining the selected bead.
 * Promote descendants past hidden workflow ancestors; retain closed ancestors of visible beads.
 */
// eslint-disable-next-line max-statements -- Ancestor traversal shares a single native index and visited set.
export function outlineHierarchy(
	hierarchy: Hierarchy,
	visibility: { closed: boolean; workflows: boolean },
	selected: string,
): Hierarchy {
	if (!visibility.workflows) {
		hierarchy = withoutHierarchyNodes(
			hierarchy,
			new Set(
				hierarchy.nodes
					.filter((node) => node.isWorkflowGenerated && node.id !== selected)
					.map((node) => node.id),
			),
		);
	}
	if (visibility.closed) {
		return hierarchy;
	}
	const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
	const visible = new Set<string>();
	const pending = [selected, ...hierarchy.nodes.filter(unclosed).map((node) => node.id)];
	while (pending.length > 0) {
		const id = pending.pop()!;
		const node = byId.get(id);
		if (node && !visible.has(id)) {
			visible.add(id);
			pending.push(...node.parentIds);
		}
	}
	return { ...hierarchy, nodes: hierarchy.nodes.filter((node) => visible.has(node.id)) };
}

/** Use complete native membership, independent of the outline's closed filter. */
export function hasHierarchy(hierarchy: Hierarchy, id: string): boolean {
	return hierarchy.nodes.some((node) => node.id !== id || node.parentIds.length > 0);
}

export interface BoardFamily extends BeadFamily {
	/** Cards matching the board's current native filters and page. */
	visible: BranchRow[];
	/** Complete unclosed membership controls layout, independent of pagination. */
	active: BranchRow[];
	/** Small single-status branches use rails; larger or split branches cross status lanes. */
	layout: "ordinary" | "rails" | "swimlane";
}

export function boardFamilies(board: Board, hierarchy: Hierarchy | null): BoardFamily[] {
	if (hierarchy === null) {
		return board.cards.map((card) => {
			const node = { ...card, parentIds: [] };
			const rows = [{ node, depth: 0 }];
			return {
				root: node,
				rows,
				visible: rows,
				active: rows.filter((row) => unclosed(row.node)),
				layout: "ordinary",
			};
		});
	}
	const visibleIds = new Set(board.cards.map((card) => card.id));
	const cards = new Map(board.cards.map((card) => [card.id, card]));
	const loadedIds = new Set(hierarchy.nodes.map((node) => node.id));
	hierarchy = {
		...hierarchy,
		nodes: [
			// Combine independently cached snapshots without mutating either source.
			// eslint-disable-next-line oxc/no-map-spread
			...hierarchy.nodes.map((node) => ({
				...node,
				...cards.get(node.id),
				parentIds: node.parentIds,
			})),
			...board.cards
				.filter((card) => !loadedIds.has(card.id))
				// eslint-disable-next-line oxc/no-map-spread -- Add temporary presentation data without mutating board cards.
				.map((card) => ({ ...card, parentIds: [] })),
		],
	};
	return groupFamilies(hierarchy, boardParents(hierarchy))
		.map((family): BoardFamily => {
			const active = family.rows.filter(({ node }) => unclosed(node));
			const visible = family.rows
				.filter(({ node }) => visibleIds.has(node.id))
				.map(({ node, depth }) => ({
					node: { ...node, ...cards.get(node.id)!, parentIds: node.parentIds },
					depth,
				}));
			const activeDescendants = active.filter(({ node }) => node.id !== family.root.id);
			let layout: BoardFamily["layout"] = "ordinary";
			if (active.length > 1) {
				layout = "swimlane";
				if (
					activeDescendants.length <= RAIL_DESCENDANT_MAXIMUM &&
					new Set(active.map(({ node }) => node.status)).size === 1
				) {
					layout = "rails";
				}
			}
			return { root: family.root, rows: family.rows, active, visible, layout };
		})
		.filter((family) => family.visible.length > 0);
}

/** Fold rail rows; descendant counts include only IDs in the current board-page match set. */
export function railRows(
	rows: BranchRow[],
	visible: Set<string>,
	expanded: Set<string>,
): (BranchRow & { descendantCount: number })[] {
	let collapsedDepth = Infinity;
	// eslint-disable-next-line max-statements -- Folding and counting use the same complete preorder branch.
	return rows.flatMap((row, index) => {
		if (row.depth <= collapsedDepth) {
			collapsedDepth = Infinity;
		}
		if (!visible.has(row.node.id) || row.depth > collapsedDepth) {
			return [];
		}
		let descendantCount = 0;
		for (const next of rows.slice(index + 1)) {
			if (next.depth <= row.depth) {
				break;
			}
			if (visible.has(next.node.id)) {
				descendantCount += 1;
			}
		}
		if (!expanded.has(row.node.id)) {
			collapsedDepth = row.depth;
		}
		return [{ ...row, descendantCount }];
	});
}

/** Extract human assignments without changing the hierarchy used by outline reads. */
export function separateHumanWork(
	board: Board,
	hierarchy: Hierarchy | null,
	nativeHierarchy: Hierarchy | null,
) {
	const cards = new Map(board.cards.map((card) => [card.id, card]));
	let current = hierarchy;
	if (current !== null) {
		current = {
			...current,
			// eslint-disable-next-line oxc/no-map-spread -- Preserve independent cached snapshots.
			nodes: current.nodes.map((node) => ({
				...node,
				...cards.get(node.id),
				parentIds: node.parentIds,
			})),
		};
	}
	const outlineIds = nativeOutlineRoots(nativeHierarchy);
	const human = board.cards
		.filter((card) => humanAssigned(card))
		.map((card) => ({ card, outlineId: outlineIds.get(card.id) }));
	let remaining = current;
	if (current !== null) {
		remaining = withoutHierarchyNodes(
			current,
			new Set(current.nodes.filter((node) => humanAssigned(node)).map((node) => node.id)),
		);
	}
	return {
		human,
		board: { ...board, cards: board.cards.filter((card) => !humanAssigned(card)) },
		hierarchy: remaining,
	};
}

/** Promote visible tasks past hidden ancestors without mutating the native hierarchy. */
export function withoutHierarchyNodes(hierarchy: Hierarchy, hidden: Set<string>): Hierarchy {
	const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
	return {
		...hierarchy,
		nodes: hierarchy.nodes
			.filter((node) => !hidden.has(node.id))
			// eslint-disable-next-line max-statements, oxc/no-map-spread -- Preserve cached native data.
			.map((node) => {
				const pending = [...node.parentIds];
				const seen = new Set<string>();
				const parentIds: string[] = [];
				while (pending.length > 0) {
					const id = pending.pop()!;
					if (!seen.has(id)) {
						seen.add(id);
						const parent = byId.get(id);
						if (parent !== undefined && hidden.has(parent.id)) {
							pending.push(...parent.parentIds);
						} else {
							parentIds.push(id);
						}
					}
				}
				return { ...node, parentIds };
			}),
	};
}

// --- Board-only ancestry and shared graph traversal ---
function nativeOutlineRoots(hierarchy: Hierarchy | null): Map<string, string> {
	const roots = new Map<string, string>();
	if (hierarchy === null) {
		return roots;
	}
	for (const family of beadFamilies(hierarchy)) {
		if (family.rows.length > 1) {
			for (const { node } of family.rows) {
				roots.set(node.id, family.root.id);
			}
		}
	}
	return roots;
}

function nativeParents(hierarchy: Hierarchy): Map<string, string[]> {
	return new Map(hierarchy.nodes.map((node) => [node.id, node.parentIds]));
}

/** Dotted IDs bridge board groups without altering native parentIds on returned nodes. */
function boardParents(hierarchy: Hierarchy): Map<string, string[]> {
	const ids = new Set(hierarchy.nodes.map((node) => node.id));
	return new Map(
		hierarchy.nodes.map((node) => {
			if (node.parentIds.length > 0) {
				return [node.id, node.parentIds];
			}
			const parts = node.id.split(".");
			const ancestor = parts
				.map((_part, index) => parts.slice(0, index).join("."))
				.toReversed()
				.find((id) => ids.has(id));
			if (ancestor === undefined) {
				return [node.id, []];
			}
			return [node.id, [ancestor]];
		}),
	);
}

function childIndex(
	nodes: HierarchyNode[],
	parents: Map<string, string[]>,
): Map<string, HierarchyNode[]> {
	const children = new Map<string, HierarchyNode[]>();
	for (const node of nodes) {
		for (const parent of parents.get(node.id)!) {
			const siblings = children.get(parent) ?? [];
			siblings.push(node);
			children.set(parent, siblings);
		}
	}
	return children;
}

// Component discovery and forest traversal share their visited sets and relation indexes.
// eslint-disable-next-line max-statements
function groupFamilies(hierarchy: Hierarchy, parents: Map<string, string[]>): BeadFamily[] {
	const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
	const children = childIndex(hierarchy.nodes, parents);
	const seen = new Set<string>();
	const families: BeadFamily[] = [];
	for (const node of hierarchy.nodes) {
		if (!seen.has(node.id)) {
			const component = connectedFamily(node, { nodes: byId, children, parents }, seen);
			const roots = component.filter((item) => !parents.get(item.id)!.some((id) => byId.has(id)));
			const emitted = new Set<string>();
			const rows = [...roots, ...component].flatMap((root) => walkBranch(children, root, emitted));
			families.push({ root: rows[0]!.node, rows });
		}
	}
	return families;
}

function walkBranch(
	children: Map<string, HierarchyNode[]>,
	root: HierarchyNode,
	seen: Set<string>,
): BranchRow[] {
	const pending = [{ node: root, depth: 0 }];
	const rows: BranchRow[] = [];
	while (pending.length > 0) {
		const row = pending.pop()!;
		if (!seen.has(row.node.id)) {
			seen.add(row.node.id);
			rows.push(row);
			pending.push(
				...(children.get(row.node.id) ?? [])
					.toReversed()
					.map((node) => ({ node, depth: row.depth + 1 })),
			);
		}
	}
	return rows;
}

function connectedFamily(
	root: HierarchyNode,
	{
		nodes,
		children,
		parents,
	}: {
		nodes: Map<string, HierarchyNode>;
		children: Map<string, HierarchyNode[]>;
		parents: Map<string, string[]>;
	},
	seen: Set<string>,
): HierarchyNode[] {
	const pending = [root];
	const family: HierarchyNode[] = [];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (!seen.has(node.id)) {
			seen.add(node.id);
			family.push(node);
			pending.push(
				...(children.get(node.id) ?? []),
				...parents
					.get(node.id)!
					.map((id) => nodes.get(id))
					.filter((parent) => parent !== undefined),
			);
		}
	}
	return family;
}

/** Both fields must be populated; absent assignment never identifies human work. */
function humanAssigned(card: Card): boolean {
	return (
		card.owner !== null &&
		card.owner.trim() !== "" &&
		card.assignee !== null &&
		card.assignee.trim() !== "" &&
		card.owner === card.assignee
	);
}
