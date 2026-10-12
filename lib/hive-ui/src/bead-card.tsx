import { BeeAssignment, Label, time } from "./ui.tsx";
import { Link, useSearch } from "@tanstack/react-router";
import type { Card } from "../contracts.ts";
import { FilterableLabel } from "./filter-controls.tsx";

export function BeadCard({ card, compact = false }: { card: Card; compact?: boolean }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	return (
		<article
			data-bead-id={card.id}
			className={`bead-card ${compact ? "compact-bead" : ""} ${search.bead === card.id ? "selected" : ""}`}
		>
			<div className="bead-card-content">
				<div className="flex items-center justify-between gap-2">
					<span className="font-mono text-[11px] text-muted">{card.id}</span>
					{!compact && <Label>P{card.priority}</Label>}
				</div>
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
			<p className="bead-card-footer">
				<span>
					<BeeAssignment card={card} />
					{card.assignee ?? "Unassigned"}
				</span>
				<span>Updated {time(card.updatedAt)}</span>
			</p>
		</article>
	);
}
