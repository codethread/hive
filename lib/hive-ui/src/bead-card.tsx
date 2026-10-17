import { BeeActivity, BeeAssignment, Label, WorkStatus, time } from "./ui.tsx";
import { Link, useSearch } from "@tanstack/react-router";
import type { Card } from "../contracts.ts";
import { FilterableLabel } from "./filter-controls.tsx";
import { MergeLinks } from "./merge-links.tsx";
import { Card as SurfaceCard } from "./primitives.tsx";
import { WorkflowIndicator } from "./workflow-preview.tsx";

export function BeadCard({
	card,
	compact = false,
	showStatus = true,
	subcards,
}: {
	card: Card;
	compact?: boolean;
	showStatus?: boolean;
	subcards?: { count: number; expanded: boolean; handleToggle: () => void } | undefined;
}) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const [latest] = card.beeAssignments.toSorted((left, right) =>
		(right.stdout?.lastOutputAt ?? "").localeCompare(left.stdout?.lastOutputAt ?? ""),
	);
	return (
		<SurfaceCard
			data-bead-id={card.id}
			data-status={card.status}
			className={`bead-card ${compact ? "compact-bead" : ""} ${search.bead === card.id ? "selected" : ""}`}
		>
			<div className="bead-card-content">
				<div className="flex items-center justify-between gap-2">
					<span className="font-mono text-[11px] text-muted">{card.id}</span>
					<div className="flex items-center gap-1">
						{subcards && (
							<button
								type="button"
								className="subcard-toggle"
								aria-label={
									`${subcards.expanded ? "Collapse" : "Expand"} ${subcards.count} ` +
									`${subcards.count === 1 ? "subcard" : "subcards"} of ${card.id}`
								}
								aria-expanded={subcards.expanded}
								onClick={subcards.handleToggle}
							>
								<span aria-hidden="true">{subcards.expanded ? "▾" : "▸"}</span>
								{subcards.count} {subcards.count === 1 ? "subcard" : "subcards"}
							</button>
						)}
						<WorkflowIndicator id={card.id} isWorkflowGenerated={card.isWorkflowGenerated} />
						<MergeLinks merges={card.merges} />
						{!compact && <Label>P{card.priority}</Label>}
					</div>
				</div>
				{showStatus && <WorkStatus status={card.status} />}
				<h3 className="bead-card-title">
					<Link
						from="/colonies/$colonyId"
						to="."
						search={(current) => ({ ...current, bead: card.id })}
						className="hover:text-accent"
						aria-current={search.bead === card.id ? "true" : undefined}
					>
						{card.title}
					</Link>
				</h3>
				{!compact && (
					<div className="flex flex-wrap gap-1">
						{card.labels.map((label) => (
							<FilterableLabel key={label} label={label} />
						))}
					</div>
				)}
			</div>
			<div className="bead-card-footer">
				<span className="bead-assignee">
					<BeeAssignment card={card} />
					{card.assignee ?? "Unassigned"}
				</span>
				{latest !== undefined && (
					<BeeActivity bee={{ outcome: "pending", stdout: latest.stdout }} />
				)}
				<span className="bead-updated">Updated {time(card.updatedAt)}</span>
			</div>
		</SurfaceCard>
	);
}
