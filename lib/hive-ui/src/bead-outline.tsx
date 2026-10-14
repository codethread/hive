import { BeeAssignment, ResourceNotice, WorkflowIndicator, time } from "./ui.tsx";
import { EMPTY, outlines, preferences, snapshot } from "./data.ts";
import type { Hierarchy, HierarchyNode } from "../contracts.ts";
import { Link, useSearch } from "@tanstack/react-router";
import { branchRows, outlineHierarchy, unclosed } from "../hierarchy.ts";
import { OutlineClosedToggle } from "./outline-controls.tsx";
import { statusName } from "./filter-controls.tsx";
import { useStore } from "zustand";

const INDENT = 24;

export function BeadOutline({ colonyId, id }: { colonyId: string; id: string }) {
	const includeClosed = useStore(preferences, (state) => state.outlineClosed);
	const resource = useStore(outlines.store, (state) => state.entries[`${colonyId}/${id}`] ?? EMPTY);
	const hierarchy = snapshot(resource);
	const root = hierarchy?.nodes.find((node) => node.id === id);
	return (
		<section className="bead-outline-page" aria-label={`Descendant outline for ${id}`}>
			<Link
				from="/colonies/$colonyId"
				to="."
				className="outline-back"
				search={(current) => {
					const { outline: _outline, bead: _bead, ...rest } = current;
					return rest;
				}}
			>
				← Back to board
			</Link>
			<ResourceNotice resource={resource} />
			{hierarchy && root && (
				<>
					<header className="bead-outline-heading">
						<div>
							<p className="family-kicker">Outline · {root.id}</p>
							<h2>
								<WorkflowIndicator isWorkflowGenerated={root.isWorkflowGenerated} />
								{root.title}
							</h2>
							<p>
								{hierarchy.nodes.length - 1} descendants · {hierarchy.nodes.filter(unclosed).length}{" "}
								unfinished
							</p>
						</div>
						<div className="flex shrink-0 flex-wrap items-center gap-4">
							<OutlineClosedToggle />
							<Link
								from="/colonies/$colonyId"
								to="."
								className="button"
								search={(current) => ({ ...current, bead: id })}
							>
								Open bead
							</Link>
						</div>
					</header>
					<div className="bead-outline-list">
						<header>
							<span>Bead</span>
							<span>Status · priority · assignee</span>
						</header>
						<OutlineBranch hierarchy={outlineHierarchy(hierarchy, includeClosed, id)} root={root} />
					</div>
				</>
			)}
		</section>
	);
}

// --- Full subtree, scoped to the deliberate outline navigation ---
function OutlineBranch({ hierarchy, root }: { hierarchy: Hierarchy; root: HierarchyNode }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	return (
		<ol>
			{branchRows(hierarchy, root).map(({ node, depth }) => (
				<li key={node.id} className="bead-outline-row" style={{ paddingLeft: depth * INDENT }}>
					<div className="bead-outline-name">
						<span aria-hidden="true" className="outline-branch-glyph">
							{depth === 0 ? "◇" : "↳"}
						</span>
						<div>
							<Link
								from="/colonies/$colonyId"
								to="."
								search={(current) => ({ ...current, bead: node.id })}
								aria-current={search.bead === node.id ? "true" : undefined}
							>
								<WorkflowIndicator isWorkflowGenerated={node.isWorkflowGenerated} />
								{node.title}
							</Link>
							<p>{node.id}</p>
						</div>
					</div>
					<div className="bead-outline-meta">
						<p>
							<span className={`status-dot status-${node.status}`} /> {statusName(node.status)}{" "}
							<span className="ml-2">P{node.priority}</span>
						</p>
						<p>
							<BeeAssignment card={node} />
							{node.assignee ?? "Unassigned"}
						</p>
						<p>Updated {time(node.updatedAt)}</p>
					</div>
				</li>
			))}
		</ol>
	);
}
