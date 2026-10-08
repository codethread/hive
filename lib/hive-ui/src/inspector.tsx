import type { Bee, Provenance } from "../contracts.ts";
import { EMPTY, details, loadProvenance, provenance, snapshot } from "./data.ts";
import { Label, ResourceNotice, outcomeName, time } from "./ui.tsx";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { detailKey, requestScopeSchema } from "../contracts.ts";
import { useStore } from "zustand";

export function Inspector({ colonyId, id }: { colonyId: string; id: string }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const key = detailKey(colonyId, id, requestScopeSchema.parse(search));
	const resource = useStore(details.store, (state) => state.entries[key] ?? EMPTY);
	const detail = snapshot(resource);
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<aside aria-label="Bead inspector" className="inspector">
			<div className="flex items-center justify-between gap-3 border-b border-line pb-3">
				<span className="font-mono text-xs text-muted">{id}</span>
				<button
					className="button"
					type="button"
					aria-label="Close bead inspector"
					onClick={() => {
						void navigate({
							search: (current) => {
								const { bead: _bead, ...rest } = current;
								return rest;
							},
						});
					}}
				>
					Close
				</button>
			</div>
			<ResourceNotice resource={resource} />
			{detail && (
				<>
					<h2 className="mt-4 text-lg leading-snug font-medium">{detail.card.title}</h2>
					<div className="my-3 flex flex-wrap gap-1">
						<Label>{detail.card.status}</Label>
						<Label>P{detail.card.priority}</Label>
						{detail.card.labels.map((label) => (
							<Label key={label}>{label}</Label>
						))}
					</div>
					<p className="mb-4 text-xs text-muted">
						Assigned to {detail.card.assignee ?? "nobody"} · updated {time(detail.card.updatedAt)}
					</p>
					<p className="whitespace-pre-wrap text-sm leading-relaxed">
						{detail.description || "No description recorded."}
					</p>
					<h3 className="section-title">Requested work</h3>
					{detail.card.bees.map((bee) => (
						<BeeContext key={bee.id} bee={bee} colonyId={colonyId} />
					))}
					{detail.card.bees.length === 0 && (
						<p className="text-sm text-muted">
							No request links this bead in the selected request page.
						</p>
					)}
					<details className="mt-6 border-t border-line pt-3">
						<summary className="text-xs text-muted">Comments · {detail.comments.length}</summary>
						<ol className="mt-4 space-y-4">
							{detail.comments.map((comment) => (
								<li key={comment.id}>
									<p className="text-[11px] text-muted">
										{comment.author} · {time(comment.at)}
									</p>
									<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.text}</p>
								</li>
							))}
						</ol>
					</details>
				</>
			)}
		</aside>
	);
}

function BeeContext({ bee, colonyId }: { bee: Bee; colonyId: string }) {
	return (
		<section className="mb-3 rounded-md border border-line p-3">
			<h4 className="break-words text-sm font-medium">{bee.identity}</h4>
			<p className="mt-1 text-[11px] text-muted">
				{bee.kind} · {bee.harness} · {bee.model}
			</p>
			<p className="mt-3 text-xs">
				Requester <span className="font-mono">{bee.requester ?? "not recorded"}</span>
			</p>
			<p className="mt-1 font-mono text-[10px] text-muted">
				{bee.id} · {outcomeName(bee.outcome)}
				{bee.closedAt !== null && ` · closed ${time(bee.closedAt)}`}
			</p>
			<div className="mt-3 border-t border-line pt-3 text-xs text-muted">
				<p>Last recorded: {bee.observation?.text ?? "No observation"}</p>
				{bee.observation && (
					<p className="mt-1">
						{time(bee.observation.at)} · {bee.observation.author}
					</p>
				)}
			</div>
			<details
				className="mt-3"
				onToggle={(event) => {
					if (event.currentTarget.open) {
						void loadProvenance(colonyId, bee.id);
					}
				}}
			>
				<summary className="text-xs text-accent">Requester provenance</summary>
				<ProvenanceChain colonyId={colonyId} id={bee.id} />
			</details>
		</section>
	);
}

function ProvenanceChain({ colonyId, id }: { colonyId: string; id: string }) {
	const resource = useStore(
		provenance.store,
		(state) => state.entries[`${colonyId}/${id}`] ?? EMPTY,
	);
	const value = snapshot(resource);
	return (
		<div className="mt-4">
			<ResourceNotice resource={resource} />
			{value && (
				<>
					<ol className="space-y-3">
						{value.chain.map((bee, index) => (
							<li
								key={bee.id}
								className={
									index > 0
										? "border-l border-dashed border-alert pl-3"
										: "border-l border-accent pl-3"
								}
							>
								<p className="text-xs">{bee.identity}</p>
								<p className="mt-1 text-[10px] text-muted">
									{index === 0 ? "Selected request" : "Inferred by requester name"} · {bee.status}
								</p>
								<p className="mt-1 text-[11px] text-muted">
									Requested by {bee.requester ?? "unknown"}
								</p>
								<div className="mt-1 flex flex-wrap gap-2">
									{bee.taskIds.map((task) => (
										<Link
											key={task}
											from="/colonies/$colonyId"
											to="."
											search={(current) => ({ ...current, bead: task })}
											className="font-mono text-[10px] text-accent underline underline-offset-2"
										>
											{task}
										</Link>
									))}
								</div>
							</li>
						))}
					</ol>
					<p className="mt-3 text-[11px] leading-relaxed text-muted">{endDescription(value.end)}</p>
					<p className="mt-2 text-[11px] leading-relaxed text-alert">
						Requester names are recorded. Bee parentage is inferred, not a captured parent link.
					</p>
				</>
			)}
		</div>
	);
}

// eslint-disable-next-line typescript/consistent-return -- TypeScript checks the exhaustive provenance union.
function endDescription(end: Provenance["end"]): string {
	switch (end.kind) {
		case "unmatched": {
			return end.requester === null
				? "Requester was not recorded."
				: `No matching bee for “${end.requester}” in this tracker.`;
		}
		case "ambiguous": {
			return `Ambiguous requester “${end.requester}”; candidates include ${end.candidates.join(", ")}. No parent chosen.`;
		}
		case "cycle": {
			return `Name matching revisits ${end.id}; traversal stopped.`;
		}
		case "limit": {
			return "Showing the first eight ancestry steps; traversal limit reached.";
		}
	}
}
