import { BeeActivity, BeeAssignment, Label, OutlineLink, WorkStatus, time } from "./ui.tsx";
import { Bug, CircleHelp, FileText, Layers, ListTodo, Sparkles, Wrench } from "lucide-react";
import { Link, useSearch } from "@tanstack/react-router";
import type { Card } from "../contracts.ts";
import { FilterableLabel } from "./filter-controls.tsx";
import type { LucideIcon } from "lucide-react";
import { MergeLinks } from "./merge-links.tsx";
import { Card as SurfaceCard } from "./primitives.tsx";
import { WorkflowIndicator } from "./workflow-preview.tsx";

const TYPE_ICONS: Record<string, LucideIcon> = {
	bug: Bug,
	chore: Wrench,
	docs: FileText,
	epic: Layers,
	feature: Sparkles,
	question: CircleHelp,
	task: ListTodo,
};

export function BeadCard({
	card,
	compact = false,
	showStatus = true,
	outlineId,
	subcards,
}: {
	card: Card;
	compact?: boolean;
	showStatus?: boolean;
	outlineId?: string | undefined;
	subcards?: { count: number; expanded: boolean; handleToggle: () => void } | undefined;
}) {
	const TypeIcon = Object.hasOwn(TYPE_ICONS, card.issueType)
		? TYPE_ICONS[card.issueType]!
		: CircleHelp;
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
					<span className="flex min-w-0 items-center gap-1.5 text-muted">
						<TypeIcon className="size-3.5 shrink-0" aria-label={card.issueType} aria-hidden={false}>
							<title>{card.issueType}</title>
						</TypeIcon>
						<span className="truncate font-mono text-[11px]">{card.id}</span>
					</span>
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
						{outlineId !== undefined && <OutlineLink id={outlineId} />}
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
