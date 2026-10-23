import type { Hierarchy, HierarchyNode } from "../contracts.ts";
import { Link, useSearch } from "@tanstack/react-router";
import { beadFamilies, hierarchyChildren, outlineHierarchy } from "../hierarchy.ts";
import { MergeLinks } from "./merge-links.tsx";
import { OutlineControls } from "./outline-controls.tsx";
import { WorkflowIndicator } from "./workflow-preview.tsx";
import { preferences } from "./data.ts";
import { statusName } from "./filter-controls.tsx";
import { useState } from "react";
import { useStore } from "zustand";

export function BranchExplorer({
	hierarchy,
	selected,
	onSelect,
}: {
	hierarchy: Hierarchy;
	selected: string;
	onSelect: () => void;
}) {
	const closed = useStore(preferences, (state) => state.outlineClosed);
	const workflows = useStore(preferences, (state) => state.outlineWorkflows);
	const visible = outlineHierarchy(hierarchy, { closed, workflows }, selected);
	const families = beadFamilies(visible);
	const childrenById = hierarchyChildren(visible);
	return (
		<aside className="branch-explorer" aria-label="Bead hierarchy">
			<div className="branch-explorer-controls">
				<OutlineControls />
			</div>
			<div className="branch-explorer-content">
				{families.map((family) => (
					<div key={family.root.id}>
						<header className="branch-explorer-heading">
							<p>{family.root.id}</p>
							<h3>
								<WorkflowIndicator
									id={family.root.id}
									isWorkflowGenerated={family.root.isWorkflowGenerated}
								/>
								{family.root.title}
							</h3>
						</header>
						<ul className="branch-explorer-tree" aria-label={`Hierarchy of ${family.root.id}`}>
							{family.rows
								.filter((row) => row.depth === 0)
								.map(({ node }) => (
									<BranchNode
										key={node.id}
										node={node}
										childrenById={childrenById}
										selected={selected}
										onSelect={onSelect}
										ancestors={[]}
									/>
								))}
						</ul>
					</div>
				))}
			</div>
		</aside>
	);
}

// --- Filtered tree; links select native beads through the inspector URL ---
function BranchNode({
	node,
	childrenById,
	selected,
	ancestors,
	onSelect,
}: {
	node: HierarchyNode;
	childrenById: Map<string, HierarchyNode[]>;
	selected: string;
	ancestors: string[];
	onSelect: () => void;
}) {
	const [folded, setFolded] = useState(false);
	const search = useSearch({ from: "/colonies/$colonyId" });
	const path = [...ancestors, node.id];
	const children = (childrenById.get(node.id) ?? []).filter((child) => !path.includes(child.id));
	return (
		<li>
			<div className={`branch-node ${selected === node.id ? "branch-node-selected" : ""}`}>
				{children.length > 0 ? (
					<button
						type="button"
						className="branch-fold"
						aria-label={`${folded ? "Expand" : "Collapse"} children of ${node.id}`}
						aria-expanded={!folded}
						onClick={() => {
							setFolded(!folded);
						}}
					>
						{folded ? "›" : "⌄"}
					</button>
				) : (
					<span className="branch-leaf-dot" aria-hidden="true">
						·
					</span>
				)}
				<Link
					from="/colonies/$colonyId"
					to="."
					search={{ ...search, bead: node.id }}
					aria-current={selected === node.id ? "true" : undefined}
					onClick={onSelect}
				>
					<span className="branch-node-id">{node.id}</span>
					<span className="branch-node-title">{node.title}</span>
					<span className="branch-node-meta">
						<span className={`status-dot status-${node.status}`} />
						{statusName(node.status)}
						<span>{node.assignee ?? "Unassigned"}</span>
					</span>
				</Link>
				<span className="flex shrink-0">
					<WorkflowIndicator id={node.id} isWorkflowGenerated={node.isWorkflowGenerated} />
					<MergeLinks merges={node.merges} />
				</span>
			</div>
			{!folded && children.length > 0 && (
				<ul>
					{children.map((child) => (
						<BranchNode
							key={child.id}
							node={child}
							childrenById={childrenById}
							selected={selected}
							ancestors={path}
							onSelect={onSelect}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
