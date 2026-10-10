import type { Bee, Card } from "../contracts.ts";
import type { ReactNode } from "react";
import type { Resource } from "./data.ts";

export function ResourceNotice<Value>({ resource }: { resource: Resource<Value> }) {
	if (resource.kind === "failed") {
		return (
			<p role="alert" className="border-b border-alert/30 bg-alert/10 px-5 py-3 text-sm text-alert">
				{resource.previous === null ? "Data unavailable. " : "Showing last-known data. "}
				{resource.message}
			</p>
		);
	}
	if (resource.kind === "loading") {
		return (
			<output className="px-5 py-2 text-xs text-muted">
				{resource.previous === null ? "Loading…" : "Refreshing; showing last-known data…"}
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
			<span aria-hidden="true">🐝</span>
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
