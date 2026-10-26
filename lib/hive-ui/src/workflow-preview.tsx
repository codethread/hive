/* eslint-disable import/max-dependencies -- The preview composes its dialog, resource and local diagram boundaries. */
import { Close, Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import {
	EMPTY,
	loadWorkflow,
	loadWorkflowOutcome,
	preferences,
	snapshot,
	workflowOutcomes,
	workflowSelection,
	workflows,
} from "./data.ts";
import { Info, RefreshCw, Workflow, X } from "lucide-react";
import type { WorkflowInspection, WorkflowOutcome } from "../contracts.ts";
import { useEffect, useRef } from "react";
import { Button } from "./primitives.tsx";
import type { Resource } from "./data.ts";
import { ResourceNotice } from "./ui.tsx";
import { WorkflowDiagram } from "./workflow-diagram.tsx";
import { pollVisibleWorkflow } from "./workflow-polling.ts";
import { useParams } from "@tanstack/react-router";
import { useStore } from "zustand";

/** Every generated bead opens its owning workflow; ordinary descendants have no action. */
export function WorkflowIndicator({
	id,
	isWorkflowGenerated,
}: {
	id: string;
	isWorkflowGenerated: boolean;
}) {
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	if (!isWorkflowGenerated) {
		return null;
	}
	return (
		<button
			type="button"
			aria-label={`View workflow for ${id}`}
			title="View workflow state"
			className="workflow-trigger rounded p-1 text-accent hover:bg-raised focus-visible:outline-2"
			onClick={(event) => {
				workflowSelection.setState({
					kind: "open",
					colony: colonyId,
					id,
					trigger: event.currentTarget,
				});
			}}
		>
			<Workflow aria-hidden="true" className="size-4" />
		</button>
	);
}

export function WorkflowDialog() {
	const selected = useStore(workflowSelection);
	if (selected.kind === "closed") {
		return null;
	}
	return (
		<OpenWorkflowDialog
			key={`${selected.colony}/${selected.id}`}
			colonyId={selected.colony}
			id={selected.id}
			trigger={selected.trigger}
		/>
	);
}

function OpenWorkflowDialog({
	colonyId,
	id,
	trigger,
}: {
	colonyId: string;
	id: string;
	trigger: HTMLButtonElement;
}) {
	const content = useRef<HTMLDivElement>(null);
	const theme = useStore(preferences, (state) => state.theme);
	const resource = useStore(
		workflows.store,
		(state) => state.entries[`${colonyId}/${id}`] ?? EMPTY,
	);
	const preview = snapshot(resource);
	const native = useStore(
		workflowOutcomes.store,
		(state) => state.entries[`${colonyId}/${id}`] ?? EMPTY,
	);
	useEffect(
		() =>
			pollVisibleWorkflow(
				async (conditional) => {
					await Promise.all([
						loadWorkflowOutcome(colonyId, id),
						loadWorkflow(colonyId, id, conditional),
					]);
				},
				{
					visible: () => document.visibilityState === "visible",
					subscribe: (changed) => {
						document.addEventListener("visibilitychange", changed);
						return () => {
							document.removeEventListener("visibilitychange", changed);
						};
					},
					schedule: (read, ms) => {
						const timer = globalThis.setInterval(read, ms);
						return () => {
							globalThis.clearInterval(timer);
						};
					},
				},
			),
		[colonyId, id],
	);
	return (
		<Root
			open
			onOpenChange={(open) => {
				if (!open) {
					workflowSelection.setState({ kind: "closed" }, true);
				}
			}}
		>
			<Portal container={trigger.closest("dialog")}>
				<Overlay className="workflow-overlay" />
				<Content
					ref={content}
					onPointerDownOutside={(event) => {
						const { target } = event.detail.originalEvent;
						if (target instanceof Node && content.current!.contains(target)) {
							event.preventDefault();
						}
					}}
					data-theme={theme}
					className="workflow-dialog workflow-dialog-modal"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						trigger.focus();
					}}
				>
					<div className="workflow-dialog-heading">
						<Title className="sr-only">Workflow preview</Title>
						<div className="workflow-run-heading">
							<Workflow aria-hidden="true" className="size-4 shrink-0 text-accent" />
							<h3 title={preview === null ? id : preview.title}>
								{preview === null ? "Workflow preview" : preview.title}
							</h3>
							<span className="workflow-run-id">{preview === null ? id : preview.runId}</span>
							{preview !== null && (
								<span className="workflow-current-state" title="Current saved state">
									<span className="workflow-status-dot" />
									<span className="text-muted">Saved</span>
									<span className="workflow-state-value">
										{typeof preview.actors[0]!.snapshot.value === "string"
											? preview.actors[0]!.snapshot.value
											: JSON.stringify(preview.actors[0]!.snapshot.value)}
									</span>
								</span>
							)}
						</div>
						<div className="workflow-dialog-actions">
							{preview !== null && <WorkflowProvenance preview={preview} />}
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label="Refresh workflow state"
								title="Refresh workflow state"
								aria-busy={resource.kind === "loading"}
								disabled={resource.kind === "loading"}
								onClick={() => {
									void Promise.all([loadWorkflowOutcome(colonyId, id), loadWorkflow(colonyId, id)]);
								}}
							>
								<RefreshCw
									aria-hidden="true"
									className={resource.kind === "loading" ? "refresh-rotating" : undefined}
								/>
							</Button>
							<Close asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label="Close workflow preview"
									title="Close workflow preview"
								>
									<X />
								</Button>
							</Close>
						</div>
					</div>
					<Description className="sr-only">
						Saved workflow state and temporary simulation for {id}. Neither changes the actual run.
					</Description>
					<WorkflowOutcomeBanner resource={native} />
					<WorkflowContent
						source={`workflow:${colonyId}/${id}`}
						resource={resource}
						colony={colonyId}
						theme={theme === "paper" ? "light" : "dark"}
					/>
				</Content>
			</Portal>
		</Root>
	);
}

function WorkflowOutcomeBanner({ resource }: { resource: Resource<WorkflowOutcome> }) {
	const native = snapshot(resource);
	return (
		<div
			className="border-b border-stroke px-4 py-2 text-sm"
			aria-label="Workflow outcome and projection"
		>
			<ResourceNotice resource={resource} source="workflow-outcome" label="Workflow outcome" />
			{native !== null && (
				<>
					<strong>Intended outcome: {native.completion?.outcome ?? "pending"}</strong>
					{native.completion !== null && <> · {native.completion.state}</>}
					<p>
						Native status: {native.nativeStatus} · Projection: {native.outcome.kind}
						{native.outcome.kind === "mismatch" && <> · {native.outcome.reason}</>}
					</p>
					{native.completion !== null && <p>{native.completion.reason}</p>}
					{!native.labelsCurrent && (
						<p>Outcome query labels are stale; they do not decide completion.</p>
					)}
					<p className="text-xs text-muted">
						Checkpoint {native.checkpoint} · {native.savedAt} · Native updated {native.updatedAt}
					</p>
				</>
			)}
		</div>
	);
}
// --- Keep the last saved diagram mounted throughout refresh and recovery. ---
function WorkflowContent({
	source,
	resource,
	colony,
	theme,
}: {
	source: string;
	resource: Resource<WorkflowInspection>;
	colony: string;
	theme: "light" | "dark";
}) {
	const preview = snapshot(resource);
	return (
		<>
			<ResourceNotice resource={resource} source={source} label="Workflow" />
			{preview !== null && <WorkflowDiagram inspection={preview} colony={colony} theme={theme} />}
		</>
	);
}

function WorkflowProvenance({ preview }: { preview: WorkflowInspection }) {
	return (
		<details className="workflow-provenance" data-source-match={preview.definition.sourceMatch}>
			<summary
				aria-label={
					preview.definition.sourceMatch === "compatible"
						? "Source differs · Saved state & diagram source"
						: "Saved state & diagram source"
				}
				title="Saved state & diagram source"
			>
				<Info aria-hidden="true" className="size-4" />
				{preview.definition.sourceMatch === "compatible" && <span>Source differs</span>}
			</summary>
			<div className="workflow-provenance-content">
				<p className="font-medium text-ink">{preview.title}</p>
				<dl className="workflow-source-facts">
					<div>
						<dt>Workflow</dt>
						<dd>{preview.definition.label}</dd>
					</div>
					<div>
						<dt>Run</dt>
						<dd>{preview.runId}</dd>
					</div>
					<div>
						<dt>State</dt>
						<dd>{JSON.stringify(preview.actors[0]!.snapshot.value)}</dd>
					</div>
					<div>
						<dt>Saved</dt>
						<dd>{new Date(preview.savedAt).toLocaleString()}</dd>
					</div>
				</dl>
				{preview.definition.sourceMatch === "compatible" && (
					<p>
						The chart uses a compatible definition whose source differs from the checkpoint&apos;s
						recorded source.
					</p>
				)}
				<p>
					Checkpoint {preview.checkpoint}. Saved state refreshes every five seconds while this
					preview is visible. Use Refresh to reload the diagram source too.
				</p>
				<p>
					Definition source:{" "}
					{preview.definition.sourceMatch === "exact"
						? "matches the saved checkpoint"
						: "compatible current version"}
					.
				</p>
				<p className="break-all font-mono">
					Saved source: {preview.definition.savedHash}
					<br />
					Current source: {preview.definition.currentHash}
				</p>
				<p>
					This diagram and its instruction panel render locally in Hive. In Saved mode, published
					briefs remain frozen and other instructions preview saved actor context. Simulate
					evaluates outcomes with supplied data. Neither mode advances the actual run.
				</p>
			</div>
		</details>
	);
}
