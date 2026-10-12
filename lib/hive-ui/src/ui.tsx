import type { Bee, Card } from "../contracts.ts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Resource } from "./data.ts";

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
}: {
	resource: Resource<Value>;
	label?: string;
}) {
	if (resource.kind === "stale") {
		return <output className="px-5 py-2 text-xs text-muted">{label} out of date</output>;
	}
	if (resource.kind === "failed") {
		return (
			<p role="alert" className="border-b border-alert/30 bg-alert/10 px-5 py-3 text-sm text-alert">
				{label}: {resource.previous === null ? "unavailable. " : "showing previous data. "}
				{resource.message}
			</p>
		);
	}
	if (resource.kind === "loading") {
		return (
			<output className="px-5 py-2 text-xs text-muted">
				{resource.previous === null
					? `Loading ${label.toLowerCase()}…`
					: `Refreshing ${label.toLowerCase()}…`}
			</output>
		);
	}
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
	if (card.beeAssignments.length === 0) {
		return null;
	}
	const requests = card.beeAssignments.map((bee) => `${bee.kind} (${bee.id})`).join(", ");
	return (
		<span
			className="mr-1"
			title={`Assigned to ${card.assignee} · ${requests}. Recorded assignment; process health is not checked.`}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 16 16"
				width="12"
				height="12"
				className="inline-block text-accent"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<circle cx="8" cy="5" r="2.5" />
				<path d="M3 14v-2a5 5 0 0 1 10 0v2" />
			</svg>
			<span className="sr-only">Bee assigned</span>
		</span>
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
	return { cancelled: "Cancelled", failed: "Failed", pending: "Pending", succeeded: "Completed" }[
		outcome
	];
}
