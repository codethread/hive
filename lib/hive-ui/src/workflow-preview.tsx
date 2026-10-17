/* eslint-disable import/max-dependencies -- The preview composes its dialog, resource and hosted diagram boundaries. */
import { Close, Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import {
	EMPTY,
	loadWorkflow,
	preferences,
	snapshot,
	workflowSelection,
	workflows,
} from "./data.ts";
import { RefreshCw, Workflow, X } from "lucide-react";
import { Button } from "./primitives.tsx";
import { ResourceNotice } from "./ui.tsx";
import { WorkflowDiagram } from "./workflow-diagram.tsx";
import type { WorkflowPreview } from "../contracts.ts";
import { useLiveRefresh } from "./use-live-refresh.ts";
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
				void loadWorkflow(colonyId, id);
			}}
		>
			<Workflow aria-hidden="true" className="size-4" />
		</button>
	);
}

export function WorkflowDialog() {
	const selected = useStore(workflowSelection);
	const theme = useStore(preferences, (state) => state.theme);
	if (selected.kind === "closed") {
		return null;
	}
	const { colony: colonyId, id, trigger } = selected;
	return (
		<Root
			open
			onOpenChange={(open) => {
				if (!open) {
					workflowSelection.setState({ kind: "closed" }, true);
				}
			}}
		>
			<Portal>
				<Overlay className="workflow-overlay" />
				<Content
					data-theme={theme}
					className="workflow-dialog workflow-dialog-modal"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						trigger.focus();
					}}
				>
					<div className="workflow-dialog-heading">
						<Title asChild>
							<h2>
								<Workflow /> Workflow preview
							</h2>
						</Title>
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="icon"
								aria-label="Refresh workflow state"
								onClick={() => {
									void loadWorkflow(colonyId, id);
								}}
							>
								<RefreshCw />
							</Button>
							<Close asChild>
								<Button variant="ghost" size="icon" aria-label="Close workflow preview">
									<X />
								</Button>
							</Close>
						</div>
					</div>
					<Description className="sr-only">
						Latest saved workflow state for {id}. Read-only preview.
					</Description>
					<WorkflowContent
						colonyId={colonyId}
						id={id}
						theme={theme === "paper" ? "light" : "dark"}
					/>
				</Content>
			</Portal>
		</Root>
	);
}

function WorkflowContent({
	colonyId,
	id,
	theme,
}: {
	colonyId: string;
	id: string;
	theme: "light" | "dark";
}) {
	useLiveRefresh(() => loadWorkflow(colonyId, id));
	const resource = useStore(
		workflows.store,
		(state) => state.entries[`${colonyId}/${id}`] ?? EMPTY,
	);
	const preview = snapshot(resource);
	return (
		<>
			<ResourceNotice resource={resource} label="Workflow preview" />
			{preview && <WorkflowSnapshot preview={preview} theme={theme} />}
		</>
	);
}

function WorkflowSnapshot({
	preview,
	theme,
}: {
	preview: WorkflowPreview;
	theme: "light" | "dark";
}) {
	return (
		<>
			<header className="workflow-preview-heading">
				<p className="workflow-eyebrow">
					{preview.runId} / {preview.definition.label}
				</p>
				<h3>{preview.title}</h3>
				<div className="workflow-preview-facts">
					<span className="workflow-current-state">
						<span className="workflow-status-dot" />
						{JSON.stringify(preview.actors[0]!.snapshot.value)}
					</span>
					<span>Checkpoint updated {new Date(preview.savedAt).toLocaleString()}</span>
				</div>
				{preview.definition.sourceMatch === "compatible" && (
					<p className="mt-3 text-xs text-muted">
						The chart uses a compatible definition whose source differs from the checkpoint&apos;s
						recorded source.
					</p>
				)}
			</header>
			<WorkflowDiagram actors={preview.actors} theme={theme} />
			<details className="workflow-provenance">
				<summary>Saved state & diagram source</summary>
				<p>
					Checkpoint {preview.checkpoint}. This is saved workflow progress; use Refresh to read it
					again.
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
					Stately receives the diagram and saved state only. Prompts, instructions and workflow
					context stay in Hive. Viewing does not advance the workflow.
				</p>
			</details>
		</>
	);
}
