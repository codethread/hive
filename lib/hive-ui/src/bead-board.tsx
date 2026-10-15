import type { Board, Hierarchy } from "../contracts.ts";
// Board composition combines column preferences, visibility and native family layout.
/* eslint-disable import/max-dependencies */
import { DEFAULT_COLUMN_ORDER, columnOrders } from "./column-settings.tsx";
import { useId, useState } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { BeadCard } from "./bead-card.tsx";
import type { BoardFamily } from "../hierarchy.ts";
import { OutlineLink } from "./ui.tsx";
import { WorkflowIndicator } from "./workflow-preview.tsx";
import { boardFamilies } from "../hierarchy.ts";
import { boardStatuses } from "./column-order.ts";
import { preferences } from "./data.ts";
import { statusName } from "./filter-controls.tsx";
import { useStore } from "zustand";

const RAIL_STEP = 18;
const RAIL_INSET = 10;

// eslint-disable-next-line max-statements -- Visibility and status columns share the same presented board snapshot.
export function BeadBoard({ board, hierarchy }: { board: Board; hierarchy: Hierarchy | null }) {
	const showWorkflowBeads = useStore(preferences, (state) => state.showWorkflowBeads);
	if (!showWorkflowBeads) {
		board = { ...board, cards: board.cards.filter((card) => !card.isWorkflowGenerated) };
		hierarchy = hierarchy === null ? null : withoutWorkflowBeads(hierarchy);
	}
	const search = useSearch({ from: "/colonies/$colonyId" });
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const preferred = useStore(
		columnOrders.store,
		(state) => state.byColony[colonyId] ?? DEFAULT_COLUMN_ORDER,
	);
	const statuses = boardStatuses(
		board.cards.map((card) => card.status),
		search.statuses,
		preferred,
	);
	const families = boardFamilies(board, hierarchy);
	const columns = families.filter((family) => family.layout !== "swimlane");
	const lanes = families.filter((family) => family.layout === "swimlane");
	if (board.cards.length === 0) {
		return (
			<div className="grid min-h-80 place-content-center gap-2 p-6 text-center">
				<h2 className="font-medium">No matching beads</h2>
			</div>
		);
	}
	return (
		<div className="adaptive-board-frame">
			<div
				className="adaptive-board"
				style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(260px, 1fr))` }}
			>
				{statuses.map((status) => (
					<header key={status} className="adaptive-status-heading">
						<h2>{statusName(status)}</h2>
						<span>{board.cards.filter((card) => card.status === status).length}</span>
					</header>
				))}
				{columns.length > 0 && (
					<section className="adaptive-columns" aria-label="Native status columns">
						{statuses.map((status) => (
							<div key={status} className="adaptive-cell" aria-label={statusName(status)}>
								{columns.map((family) => (
									<ColumnFamily key={family.root.id} family={family} status={status} />
								))}
							</div>
						))}
					</section>
				)}
				{lanes.map((family) => (
					<FamilyLane key={family.root.id} family={family} statuses={statuses} />
				))}
			</div>
		</div>
	);
}

// --- Adaptive presentation over the complete native family ---
function ColumnFamily({ family, status }: { family: BoardFamily; status: string }) {
	const rows = family.visible.filter(({ node }) => node.status === status);
	if (rows.length === 0) {
		return null;
	}
	return (
		<div
			className={family.layout === "rails" ? "bead-rail-family" : "space-y-3"}
			data-family-id={family.root.id}
			data-layout={family.layout}
		>
			{rows.map(({ node, depth }, index) => (
				<div
					key={node.id}
					className={family.layout === "rails" && depth > 0 ? "bead-rail-child" : ""}
					data-continues={rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth}
					style={family.layout === "rails" ? { marginLeft: depth * RAIL_STEP } : undefined}
				>
					{family.layout === "rails" &&
						Array.from({ length: Math.max(0, depth - 1) }, (_value, offset) => offset + 1)
							.filter(
								(level) => rows.slice(index + 1).find((row) => row.depth <= level)?.depth === level,
							)
							.map((level) => (
								<span
									key={level}
									aria-hidden="true"
									className="bead-rail-ancestor"
									style={{ left: (level - depth) * RAIL_STEP - RAIL_INSET }}
								/>
							))}
					<BeadCard
						card={node}
						compact={family.layout === "rails" && node.id !== family.root.id}
						showStatus={false}
					/>
				</div>
			))}
		</div>
	);
}

function FamilyLane({ family, statuses }: { family: BoardFamily; statuses: string[] }) {
	const [collapsed, setCollapsed] = useState(false);
	const hiddenCountId = useId();
	const columns = statuses.map((status) => ({
		status,
		rows: family.visible.filter(({ node }) => node.status === status),
	}));
	const hiddenCount = family.visible.length - columns.filter(({ rows }) => rows.length > 0).length;
	return (
		<section
			className="adaptive-family"
			aria-label={`Family: ${family.root.title}`}
			data-family-id={family.root.id}
			data-layout="swimlane"
		>
			<header className="adaptive-family-heading">
				<h3 className="family-label">
					<button
						type="button"
						className="family-toggle"
						aria-label={`${collapsed ? "Expand" : "Collapse"} lane ${family.root.id}`}
						aria-describedby={collapsed && hiddenCount > 0 ? hiddenCountId : undefined}
						aria-expanded={!collapsed}
						onClick={() => {
							setCollapsed(!collapsed);
						}}
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
						</svg>
						<span className="family-id">{family.root.id}</span>
						<span className="family-title" title={family.root.title}>
							{family.root.title}
						</span>
						{collapsed && hiddenCount > 0 && (
							<span id={hiddenCountId} className="family-hidden-count">
								{hiddenCount} hidden
							</span>
						)}
					</button>
					<WorkflowIndicator
						id={family.root.id}
						isWorkflowGenerated={family.root.isWorkflowGenerated}
					/>
					<OutlineLink id={family.root.id} />
				</h3>
			</header>
			{columns.map(({ status, rows }) => (
				<div key={status} className="adaptive-cell" aria-label={statusName(status)}>
					{(collapsed ? rows.slice(0, 1) : rows).map(({ node }) => (
						<BeadCard
							key={node.id}
							card={node}
							compact={node.id !== family.root.id}
							showStatus={false}
						/>
					))}
				</div>
			))}
		</section>
	);
}

/** Promote visible tasks past hidden workflow ancestors for board presentation only. */
function withoutWorkflowBeads(hierarchy: Hierarchy): Hierarchy {
	const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]));
	return {
		...hierarchy,
		nodes: hierarchy.nodes
			.filter((node) => !node.isWorkflowGenerated)
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
						if (parent?.isWorkflowGenerated === true) {
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
