import type { Bee, Detail, Provenance, Relation } from "../contracts.ts";
import { BeeAssignment, Label, OutlineLink, ResourceNotice, outcomeName, time } from "./ui.tsx";
import {
	EMPTY,
	details,
	hierarchies,
	loadDetail,
	loadHierarchy,
	loadProvenance,
	provenance,
	snapshot,
} from "./data.ts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.tsx";
import { boardScopeSchema, detailKey, hierarchyKey } from "../contracts.ts";
import { BranchExplorer } from "./branch-explorer.tsx";
import { FilterableLabel } from "./filter-controls.tsx";
import { hasHierarchy } from "../hierarchy.ts";
import { useStore } from "zustand";

const MarkdownContent = lazy(async () => {
	const module = await import("./markdown.tsx");
	return { default: module.MarkdownContent };
});

// eslint-disable-next-line max-statements -- Keep the selected resource, modal lifecycle and URL navigation together.
export function Inspector({ colonyId, id }: { colonyId: string; id: string }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const scope = boardScopeSchema.parse(search);
	const key = detailKey(colonyId, id, scope);
	const resource = useStore(details.store, (state) => state.entries[key] ?? EMPTY);
	const detail = snapshot(resource);
	const hierarchyResource = useStore(
		hierarchies.store,
		(state) => state.entries[hierarchyKey(colonyId, [id])] ?? EMPTY,
	);
	const hierarchy = snapshot(hierarchyResource);
	const showOutline = hierarchy === null || hasHierarchy(hierarchy, id);
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const dialogRef = useRef<HTMLDialogElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const beadTabRef = useRef<HTMLButtonElement>(null);
	const [pane, setPane] = useState("bead");
	useLayoutEffect(() => {
		const dialog = dialogRef.current!;
		dialog.showModal();
		return () => {
			// Close before React removes the dialog so the browser restores focus to its opener.
			dialog.close();
		};
	}, []);
	useEffect(() => {
		if (document.activeElement?.closest(".branch-explorer, .inspector-tabs")) {
			return;
		}
		closeRef.current!.focus();
		// eslint-disable-next-line react/exhaustive-effect-dependencies -- Related-bead navigation resets keyboard focus when the previous link disappears.
	}, [id]);
	const close = () => {
		void navigate({
			search: (current) => {
				const { bead: _bead, ...rest } = current;
				return rest;
			},
		});
	};
	return (
		<dialog
			ref={dialogRef}
			aria-labelledby="inspector-title"
			className="inspector"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 sm:px-8">
				<div className="min-w-0">
					<p id="inspector-title" className="text-sm font-medium">
						Bead details
					</p>
					<p className="mt-1 break-all font-mono text-xs text-muted">{id}</p>
				</div>
				<div className="flex items-center gap-2">
					<OutlineLink id={id} />
					<button
						className="button"
						type="button"
						disabled={resource.kind === "loading" || hierarchyResource.kind === "loading"}
						onClick={() => {
							const refreshAfter = Date.now();
							void loadDetail(colonyId, id, { refreshAfter, scope });
							void loadHierarchy(colonyId, [id], refreshAfter);
						}}
					>
						Refresh
					</button>
					<button
						ref={closeRef}
						className="button"
						type="button"
						aria-label="Close bead inspector"
						onClick={close}
					>
						Close{" "}
						<span aria-hidden="true" className="ml-1 text-muted">
							Esc
						</span>
					</button>
				</div>
			</header>
			<Tabs
				value={showOutline ? pane : "bead"}
				onValueChange={setPane}
				className="inspector-tabs-root"
			>
				{showOutline && (
					<TabsList className="inspector-tabs" aria-label="Inspector views">
						<TabsTrigger ref={beadTabRef} value="bead">
							Bead
						</TabsTrigger>
						<TabsTrigger value="outline">Outline</TabsTrigger>
					</TabsList>
				)}
				<div className={`inspector-layout ${showOutline ? "inspector-with-outline" : ""}`}>
					{/* Keep both panes mounted for the desktop split view and preserve outline state. */}
					<TabsContent
						key={id}
						value="bead"
						forceMount
						className="inspector-body"
						role={showOutline ? "tabpanel" : "region"}
						aria-label="Bead"
					>
						<ResourceNotice resource={resource} />
						{detail && (
							<>
								<h2 className="mt-6 text-2xl leading-snug font-medium">{detail.card.title}</h2>
								<div className="my-3 flex flex-wrap items-center gap-1">
									<Label>{detail.card.status}</Label>
									<Label>P{detail.card.priority}</Label>
									{detail.card.labels.map((label) => (
										<FilterableLabel key={label} label={label} />
									))}
								</div>
								<p className="mb-6 text-xs text-muted">
									<BeeAssignment card={detail.card} />
									{detail.card.assignee ?? "Unassigned"} · updated {time(detail.card.updatedAt)}
								</p>
								<section aria-label="Description">
									<h3 className="section-title">Description</h3>
									<p className="whitespace-pre-wrap text-sm leading-relaxed">
										{detail.description || "No description."}
									</p>
								</section>
								<section
									aria-label="Acceptance criteria"
									className="mt-6 rounded-lg border border-line bg-canvas px-5 pb-5"
								>
									<h3 className="section-title">Acceptance criteria</h3>
									{detail.acceptanceCriteria ? (
										<Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
											<MarkdownContent>{detail.acceptanceCriteria}</MarkdownContent>
										</Suspense>
									) : (
										<p className="text-sm text-muted">No acceptance criteria.</p>
									)}
								</section>
								<div className="grid gap-x-6 md:grid-cols-2">
									<Relations direction="outgoing" relations={detail.dependencies} />
									<Relations direction="incoming" relations={detail.dependents} />
								</div>
								{search.view !== "beads" && (
									<>
										<h3 className="section-title">Requested work</h3>
										{detail.card.bees.map((bee) => (
											<BeeContext key={bee.id} bee={bee} colonyId={colonyId} />
										))}
										{detail.card.bees.length === 0 && (
											<p className="text-sm text-muted">
												No request links this bead in the selected request page.
											</p>
										)}
									</>
								)}
								<details className="mt-6 border-t border-line pt-3">
									<summary className="text-xs text-muted">
										Comments · {detail.comments.length}
									</summary>
									<ol className="mt-4 space-y-4">
										{detail.comments.map((comment) => (
											<li key={comment.id}>
												<p className="text-[11px] text-muted">
													{comment.author} · {time(comment.at)}
												</p>
												<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
													{comment.text}
												</p>
											</li>
										))}
									</ol>
								</details>
							</>
						)}
					</TabsContent>
					{showOutline && (
						<TabsContent value="outline" forceMount className="inspector-hierarchy">
							<ResourceNotice resource={hierarchyResource} label="Outline" />
							{hierarchy && (
								<BranchExplorer
									hierarchy={hierarchy}
									selected={id}
									onSelect={() => {
										setPane("bead");
										if (globalThis.matchMedia("(max-width: 760px)").matches) {
											beadTabRef.current!.focus();
										}
									}}
								/>
							)}
						</TabsContent>
					)}
				</div>
			</Tabs>
		</dialog>
	);
}

// --- Selected-bead relationships and request context ---
function Relations({
	direction,
	relations,
}: {
	direction: "outgoing" | "incoming";
	relations: Detail["dependencies"];
}) {
	const title = direction === "outgoing" ? "Dependencies · outgoing" : "Dependents · incoming";
	return (
		<section aria-label={title} className="min-w-0">
			<h3 className="section-title">
				{title} · {relations.total}
			</h3>
			{relations.total === 0 && <p className="text-sm text-muted">None.</p>}
			<ul className="space-y-2">
				{relations.items.map((relation) => (
					<li key={`${relation.id}/${relation.dependencyType}`}>
						<Link
							from="/colonies/$colonyId"
							to="."
							search={(current) => ({ ...current, bead: relation.id })}
							className="block rounded-lg border border-line bg-card p-3 hover:border-accent"
						>
							<p className="text-xs text-accent">
								{relationName(relation, direction)} <span className="font-mono">{relation.id}</span>
							</p>
							<p className="mt-1 text-sm leading-snug">{relation.title}</p>
							<div className="mt-2 flex flex-wrap gap-1">
								<Label>{relation.status}</Label>
								<Label>P{relation.priority}</Label>
								<Label>{relation.dependencyType}</Label>
							</div>
						</Link>
					</li>
				))}
			</ul>
			{relations.total > relations.items.length && (
				<p className="mt-3 text-xs text-alert">
					Showing {relations.items.length} of {relations.total} relationships in this direction.
				</p>
			)}
		</section>
	);
}

function relationName(relation: Relation, direction: "outgoing" | "incoming"): string {
	if (relation.dependencyType === "blocks") {
		return direction === "outgoing" ? "Depends on" : "Blocks";
	}
	return direction === "outgoing" ? "Links to" : "Linked from";
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
