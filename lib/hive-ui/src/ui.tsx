import type { Bee, Card, Hierarchy } from "../contracts.ts";
import {
	Circle,
	CircleCheck,
	CircleDashed,
	CircleHelp,
	Eye,
	Timer,
	TriangleAlert,
	UserRound,
} from "lucide-react";
import { beeActivity, outputAge } from "./activity.ts";
import { useEffect, useRef } from "react";
import { Badge } from "./primitives.tsx";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Resource } from "./data.ts";
import { statusName } from "./filter-controls.tsx";
import { toast } from "sonner";
import { useActivityClock } from "./activity-clock.tsx";

export function HierarchyNotice({
	resource,
	source,
}: {
	resource: Resource<Hierarchy>;
	source: string;
}) {
	return <ResourceNotice resource={resource} source={source} label="Hierarchy" />;
}

export function BeeActivity({ bee }: { bee: Pick<Bee, "outcome" | "stdout"> }) {
	const now = useActivityClock();
	const activity = beeActivity(bee, now);
	const ActivityIcon = activity === "attention" ? TriangleAlert : CircleHelp;
	const at = bee.stdout?.lastOutputAt ?? null;
	if (activity === "ended") {
		return null;
	}
	return (
		<span
			className={`bee-activity bee-activity-${activity}`}
			title={
				at === null
					? "No stdout evidence for the current attempt. Assignment alone does not establish activity."
					: `Last recorded output ${time(at)}. Active means output in the last 2 minutes. ` +
						"Investigate after 10 minutes without output; this does not confirm a stalled process."
			}
		>
			<Badge variant="outline" className="bee-activity-badge">
				{activity === "active" ? (
					<span aria-hidden="true">🐝</span>
				) : (
					<ActivityIcon aria-hidden="true" />
				)}
				<span className={activity === "active" ? "sr-only" : undefined}>
					{
						{
							active: "Active bee",
							attention: "Needs investigation",
							quiet: "No recent output",
							unknown: "Activity unknown",
						}[activity]
					}
				</span>
			</Badge>
			{at !== null && <span className="bee-output-age">Output {outputAge(at, now)}</span>}
		</span>
	);
}

export function WorkStatus({ status }: { status: string }) {
	const icons: Record<string, typeof Circle> = {
		in_progress: Timer,
		blocked: TriangleAlert,
		closed: CircleCheck,
		in_review: Eye,
		draft: CircleDashed,
	};
	const Icon = icons[status] ?? Circle;
	return (
		<Badge variant="outline" className="work-status" data-status={status}>
			<Icon aria-hidden="true" />
			{statusName(status)}
		</Badge>
	);
}

export function OutlineLink({ id }: { id: string }) {
	return (
		<Link
			from="/colonies/$colonyId"
			to="."
			search={(current) => {
				const { bead: _bead, ...rest } = current;
				return { ...rest, outline: id, view: "beads" };
			}}
			className="outline-link"
			aria-label={`Open descendant outline for ${id}`}
			title="Open descendant outline"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M3 2v11h3M3 5h3M8 3h5M8 5h3M8 11h5M8 13h3"
					stroke="currentColor"
					strokeWidth="1.3"
					strokeLinecap="round"
				/>
			</svg>
		</Link>
	);
}

export function ResourceNotice<Value>({
	resource,
	label = "Data",
	source,
}: {
	resource: Resource<Value>;
	label?: string;
	source: string;
}) {
	const notified = useRef(new Map<string, string>());
	const message = resource.kind === "failed" ? resource.message : null;
	const unavailable = resource.kind === "failed" && resource.previous === null;
	useEffect(() => {
		const id = `${source}:${label}:${message}`;
		const previous = notified.current.get(source);
		if (message !== null && previous !== id) {
			notified.current.set(source, id);
			toast.error(`${label} ${unavailable ? "unavailable" : "could not update"}`, {
				id,
				description: `${unavailable ? "" : "Showing previous data. "}${message}`,
			});
		} else if (resource.kind === "ready" && previous !== undefined) {
			toast.dismiss(previous);
			notified.current.delete(source);
		}
	}, [label, message, unavailable, resource.kind, source]);
	return null;
}

export function Label({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
			{children}
		</span>
	);
}

export function BeeAssignment({ card }: { card: Card }) {
	return (
		<>
			{card.beeAssignments.map((bee) => (
				<Link
					key={bee.id}
					from="/colonies/$colonyId"
					to="."
					search={(current) => {
						const { bead: _bead, outline: _outline, ...rest } = current;
						return {
							...rest,
							view: "open",
							page: 0,
							requestPage: 0,
							request: bee.id,
							ancestry: bee.id,
							beeQuery: "",
						};
					}}
					className="mr-1 rounded hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
					title={
						`Bee assigned: ${card.assignee} · ${bee.kind} (${bee.id}). ` +
						"Inspect recorded request details."
					}
				>
					<UserRound aria-hidden="true" className="inline-block size-3 text-muted" />
					<span className="sr-only">
						Bee assigned · inspect {bee.kind} request {bee.id}
					</span>
				</Link>
			))}
		</>
	);
}

export function time(value: string): string {
	return new Date(value).toLocaleString(undefined, {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
		second: "2-digit",
	});
}

export function outcomeName(outcome: Bee["outcome"]): string {
	return { cancelled: "Cancelled", failed: "Failed", pending: "Open", succeeded: "Completed" }[
		outcome
	];
}
