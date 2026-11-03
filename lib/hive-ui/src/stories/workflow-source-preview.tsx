import { COLONY_ID, OBSERVED_AT, cards, fixtureDetail } from "./fixtures.ts";
import { HttpResponse, http } from "msw";
import { Link, useSearch } from "@tanstack/react-router";
import { BeadCard } from "../bead-card.tsx";
import type { Card } from "../../contracts.ts";
import { useState } from "react";

interface WorkflowPreview {
	/** Independent native identity and title of the workflow run. */
	card: Card;
	/** Original work, linked without changing its native hierarchy. */
	sources: Card[];
	/** Generated children with independent progress and completion. */
	steps: Card[];
	/** Branch or PR being landed by this run. */
	target: string;
	/** Next chart step, which has no native bead yet. */
	upcoming: string;
}

const runs: WorkflowPreview[] = [
	{
		card: previewCard("hv-land-ui", "Land the Hive UI", "in_progress"),
		sources: [cards[0]!],
		target: "feat/hive-ui",
		upcoming: "Merge the Hive UI",
		steps: [
			previewCard("hv-land-ui.1", "Check the Hive UI", "closed"),
			previewCard("hv-land-ui.2", "Review the Hive UI", "in_progress"),
		],
	},
	{
		card: previewCard("hv-land-outline", "Land the outline polish", "in_progress"),
		sources: [cards.find((card) => card.id === "hv-rails")!],
		target: "feat/outline-polish",
		upcoming: "Verify the integrated outline",
		steps: [
			previewCard("hv-land-outline.1", "Review the outline polish", "closed"),
			previewCard("hv-land-outline.2", "Merge the outline polish", "in_progress"),
		],
	},
	{
		card: previewCard(
			"hv-land-provenance",
			"Land bee provenance and linked-work inspection",
			"in_progress",
		),
		sources: cards.filter((card) => ["hv-ui.1", "hv-ui.2"].includes(card.id)),
		target: "PR #142 · feat/bee-provenance",
		upcoming: "Review both provenance changes",
		steps: [
			previewCard("hv-land-provenance.1", "Implement linked-work inspection", "closed"),
			previewCard("hv-land-provenance.2", "Check both provenance changes", "in_progress"),
		],
	},
];

/** Interactive presentation proposal; all work and relationships are fixture data. */
export function WorkflowSourcePreview() {
	const { bead } = useSearch({ from: "/colonies/$colonyId" });
	const [focus, setFocus] = useState<string | null>(null);
	const visible = runs.filter((run) => focus === null || run.card.id === focus);
	const selectedRun = runs.find(
		(run) => run.card.id === bead || run.steps.some((step) => step.id === bead),
	);
	const selected =
		selectedRun?.steps.find((step) => step.id === bead) ??
		selectedRun?.card ??
		cards.find((card) => card.id === bead);
	let selectedKind = "original work";
	if (selectedRun) {
		selectedKind = selected?.id === selectedRun.card.id ? "Land run" : "workflow step";
	}
	const linkedRuns = runs.filter((run) => run.sources.some((source) => source.id === bead));
	return (
		<div className="mx-auto max-w-screen-2xl space-y-6 p-6">
			<header className="space-y-3">
				<p className="text-xs uppercase tracking-widest text-accent">
					Workflow sources · Interactive demo
				</p>
				<h1 className="text-2xl font-semibold">Follow the work through Land</h1>
				<p className="max-w-3xl text-sm text-muted">
					Each row connects the work you asked for to its Land run and the steps that run creates.
					Select any card to explore its links.
				</p>
				<div className="grid gap-3 rounded-md border border-line bg-panel p-4 text-sm md:grid-cols-3">
					<p>
						<strong>1. Original work</strong>
						<br />
						<span className="text-muted">
							The requested feature or fix. It retains its own bead and acceptance criteria.
						</span>
					</p>
					<p>
						<strong>2. Land run</strong>
						<br />
						<span className="text-muted">
							The process for finishing that scope. It links back to one or several original beads.
						</span>
					</p>
					<p>
						<strong>3. Workflow steps</strong>
						<br />
						<span className="text-muted">
							Generated tasks beneath the run. Finishing a step advances the workflow.
						</span>
					</p>
				</div>
			</header>
			{selected && (
				<section
					className="space-y-3 rounded-md border border-line bg-panel p-4"
					aria-label="Selected bead relationships"
				>
					<p className="text-xs uppercase tracking-wide text-accent">Selected {selectedKind}</p>
					<div className="grid gap-4 md:grid-cols-2">
						<div>
							<BeadCard card={selected} />
							<p className="mt-2 text-xs text-muted">Status: {statusLabel(selected.status)}</p>
						</div>
						<div className="space-y-3">
							{selectedRun ? (
								<>
									{selected.id !== selectedRun.card.id && (
										<RelationshipLinks title="Parent workflow" items={[selectedRun.card]} />
									)}
									<RelationshipLinks title="Original work" items={selectedRun.sources} />
									<p className="text-xs text-muted">Target: {selectedRun.target}</p>
									<RelationshipLinks title="Generated steps" items={selectedRun.steps} />
								</>
							) : (
								<RelationshipLinks
									title="Workflow runs for this work"
									items={linkedRuns.map((run) => run.card)}
								/>
							)}
						</div>
					</div>
				</section>
			)}
			<div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Workflow scope filter">
				<span className="mr-2 text-muted">Show:</span>
				<button
					type="button"
					className="rounded border border-line px-3 py-1 hover:text-accent"
					aria-pressed={focus === null}
					onClick={() => {
						setFocus(null);
					}}
				>
					All 3 runs
				</button>
				{runs.map((run) => (
					<button
						key={run.card.id}
						type="button"
						className="rounded border border-line px-3 py-1 hover:text-accent"
						aria-pressed={focus === run.card.id}
						onClick={() => {
							setFocus(run.card.id);
						}}
					>
						{run.card.title}
					</button>
				))}
			</div>
			{visible.map((run) => (
				<section
					key={run.card.id}
					className="overflow-hidden rounded-lg border border-line"
					aria-label={`Work and workflow: ${run.card.title}`}
				>
					<header className="flex flex-wrap justify-between gap-2 border-b border-line bg-panel px-4 py-3">
						<h2 className="font-semibold">{run.card.title}</h2>
						<span className="text-xs text-muted">{run.target}</span>
					</header>
					<div className="grid gap-5 p-4 lg:grid-cols-3">
						<div className="space-y-3">
							<h3 className="text-xs uppercase tracking-wide text-muted">1 · Original work</h3>
							{run.sources.map((source) => (
								<BeadCard key={source.id} card={source} />
							))}
							<p className="text-xs text-muted">
								{run.sources.length === 1 ? "One source bead" : "Two source beads share this run"}
							</p>
						</div>
						<div className="space-y-3">
							<h3 className="text-xs uppercase tracking-wide text-muted">2 · Land run</h3>
							<BeadCard card={run.card} />
							<div className="rounded border border-line bg-panel p-3">
								<RelationshipLinks title="Original work" items={run.sources} />
							</div>
							<p className="text-xs text-muted">In progress · Links preserve the original work.</p>
						</div>
						<div className="space-y-3">
							<h3 className="text-xs uppercase tracking-wide text-muted">
								3 · Generated workflow steps
							</h3>
							{run.steps.map((step) => (
								<div key={step.id} className="space-y-1 border-l-2 border-line pl-3">
									<p className="flex items-center gap-2 text-xs text-muted">
										<span className={`status-dot status-${step.status}`} />
										{statusLabel(step.status)}
									</p>
									<BeadCard card={step} compact />
								</div>
							))}
							<div className="space-y-1 rounded border border-dashed border-line p-3 text-sm">
								<p className="text-xs text-muted">Upcoming · No bead yet</p>
								<p>{run.upcoming}</p>
								<p className="text-xs text-muted">Created when the workflow enters this step.</p>
							</div>
						</div>
					</div>
				</section>
			))}
			<p className="text-xs text-muted">
				Preview data. Original work stays independent; generated steps are children of the workflow
				run. Linking work grants no completion authority.
			</p>
		</div>
	);
}

function RelationshipLinks({ title, items }: { title: string; items: Card[] }) {
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-semibold">{title}</h3>
			{items.map((item) => (
				<Link
					key={item.id}
					from="/colonies/$colonyId"
					to="."
					search={(current) => ({ ...current, bead: item.id })}
					className="flex items-start gap-2 text-xs hover:text-accent"
				>
					<span className="font-mono text-accent">{item.id}</span>
					<span>{item.title}</span>
				</Link>
			))}
		</div>
	);
}

function previewCard(id: string, title: string, status: string): Card {
	return {
		...cards[0]!,
		id,
		title,
		status,
		labels: [],
		assignee: "amber-quiet-otter",
		beeAssignments: [],
	};
}

function statusLabel(status: string): string {
	return { closed: "Completed", in_progress: "In progress", open: "Open" }[status] ?? status;
}

/** Links resolve to isolated details; no interaction reaches the native tracker. */
export const workflowPreviewHandlers = runs.flatMap((run) =>
	[run.card, ...run.steps].flatMap((card) => [
		http.get(`/api/colonies/${COLONY_ID}/beads/${card.id}`, () =>
			HttpResponse.json({
				...fixtureDetail(run.sources[0]!.id),
				card,
				description: "Land this scope, preserving links to the original work.",
				dependencies: {
					items: run.sources.map((source) => ({ ...source, dependencyType: "discovered-from" })),
					total: run.sources.length,
				},
				dependents: { items: [], total: 0 },
			}),
		),
		http.get(`/api/colonies/${COLONY_ID}/outline/${card.id}`, () =>
			HttpResponse.json({
				fetchedAt: OBSERVED_AT,
				nodes: [{ ...card, parentIds: card.id === run.card.id ? [] : [run.card.id] }],
			}),
		),
	]),
);
