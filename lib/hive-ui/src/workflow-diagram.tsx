import {
	SimulationControls,
	SimulationMode,
	useWorkflowSimulation,
} from "./workflow-simulation.tsx";
import { useMemo, useState } from "react";
import { workflowActorGraph, workflowActorTitle } from "./workflow-graph.ts";
import { MarkdownContent } from "./markdown.tsx";
import type { ReactNode } from "react";
import { WorkflowCanvas } from "./workflow-canvas.tsx";
import { WorkflowDispatch } from "./workflow-dispatch.tsx";
import type { WorkflowInspection } from "../contracts.ts";
import { WorkflowWorkspace } from "./workflow-workspace.tsx";

const LAST = -1;
type InspectionActor = WorkflowInspection["actors"][number];

/** Inspect saved state or a temporary simulation of one retained actor. */
// eslint-disable-next-line max-statements -- Resolve retired actor selection separately from a pinned simulation.
export function WorkflowDiagram({
	inspection,
	colony,
	theme,
}: {
	inspection: WorkflowInspection;
	colony: string;
	theme: "light" | "dark";
}) {
	const [actorSelection, setActorSelection] = useState({
		id: inspection.actors[0]!.id,
		retired: "",
	});
	const actorId = actorSelection.id;
	const latestActor =
		inspection.actors.find((entry) => entry.id === actorId) ?? inspection.actors[0]!;
	const simulation = useWorkflowSimulation(colony, inspection, latestActor.id);
	const { actors } = simulation.inspection;
	const actor = actors.find((entry) => entry.id === simulation.actorId)!;
	if (!simulation.active && actorId !== latestActor.id) {
		setActorSelection({ id: latestActor.id, retired: actorId });
	}
	return (
		<div className="workflow-preview-body">
			{actorSelection.retired !== "" && !simulation.active && (
				<output className="px-6 py-2 text-sm text-muted">
					Actor {actorSelection.retired} is no longer retained in the saved checkpoint. Showing the
					root actor.
				</output>
			)}
			<SavedActorExplorer
				actors={actors}
				actor={
					simulation.active && simulation.session !== null
						? simulation.session.response.actor
						: actor
				}
				saved={actor}
				theme={theme}
				simulated={simulation.active && simulation.session !== null}
				navigationDisabled={simulation.active}
				onOpenWorkflow={(id) => {
					setActorSelection({ id, retired: "" });
				}}
				toolbar={<SimulationMode simulation={simulation} />}
				footer={simulation.active && <SimulationControls simulation={simulation} />}
			/>
		</div>
	);
}

// eslint-disable-next-line max-statements -- Retain graph layout and user selection while saved actor snapshots change.
function SavedActorExplorer({
	actors,
	actor,
	saved,
	theme,
	toolbar,
	footer,
	simulated,
	navigationDisabled,
	onOpenWorkflow,
}: {
	actors: WorkflowInspection["actors"];
	actor: InspectionActor;
	saved: InspectionActor;
	theme: "light" | "dark";
	toolbar: ReactNode;
	footer: ReactNode;
	simulated: boolean;
	navigationDisabled: boolean;
	onOpenWorkflow: (id: string) => void;
}) {
	const projection = useMemo(() => workflowActorGraph(saved, actors), [saved, actors]);
	const [savedGraph, setSavedGraph] = useState(projection.graph);
	let { graph } = projection;
	if (JSON.stringify(savedGraph) === JSON.stringify(graph)) {
		graph = savedGraph;
	} else {
		setSavedGraph(graph);
	}
	const { current } = useMemo(() => workflowActorGraph(actor), [actor]);
	const source = simulated ? actor : null;
	const [selection, setSelection] = useState(() => ({
		actorId: actor.id,
		source,
		step: current.at(LAST)!,
	}));
	if (
		selection.actorId !== actor.id ||
		selection.source !== source ||
		!(selection.step in projection.graph.steps)
	) {
		setSelection({ actorId: actor.id, source, step: current.at(LAST)! });
	}
	const selected = selection.step;
	const instructions = actor.instructions[selected]!;
	const available = [
		...new Set(current.flatMap((id) => graph.transitions[id]!.map((edge) => edge.target))),
	];
	const workflowLink = (entry: InspectionActor) => ({
		id: entry.id,
		title: workflowActorTitle(entry),
		status: entry.snapshot.status,
	});
	const workflowPath = actors
		.filter(
			(entry) =>
				JSON.stringify(entry.path) === JSON.stringify(saved.path.slice(0, entry.path.length)),
		)
		.toSorted((left, right) => left.path.length - right.path.length)
		.map((entry) => workflowLink(entry));
	const children = actors
		.filter(
			(entry) =>
				entry.path.length === saved.path.length + 1 &&
				JSON.stringify(entry.path.slice(0, LAST)) === JSON.stringify(saved.path),
		)
		.map((entry) => workflowLink(entry));
	return (
		<main className="workflow-explorer workflow-saved-explorer">
			<section className="explorer-workspace" aria-label="Workflow with instruction panel">
				<WorkflowWorkspace
					diagram={
						<WorkflowCanvas
							identity={actor.id}
							graph={graph}
							toolbar={toolbar}
							workflowNavigation={{
								path: workflowPath,
								children,
								disabled: navigationDisabled,
								onOpen: onOpenWorkflow,
							}}
							current={current}
							available={available}
							availableLabel="Direct target"
							selected={selected}
							focusSelection={selection}
							theme={theme}
							onInspect={(step) => {
								setSelection({ actorId: actor.id, source, step });
							}}
						/>
					}
					heading={
						<label className="explorer-state-picker">
							Inspect step
							<select
								value={selected}
								onChange={(event) => {
									setSelection({ actorId: actor.id, source, step: event.target.value });
								}}
							>
								{Object.entries(graph.steps).map(([id, step]) => (
									<option key={id} value={id}>
										{step.title}
									</option>
								))}
							</select>
						</label>
					}
				>
					<SavedInstructions instructions={instructions} simulated={simulated} />
				</WorkflowWorkspace>
				{footer}
			</section>
		</main>
	);
}

function SavedInstructions({
	instructions,
	simulated,
}: {
	instructions: InspectionActor["instructions"][string];
	simulated: boolean;
}) {
	if (instructions.kind === "none") {
		return (
			<>
				<p className="explorer-instruction-source">Workflow definition</p>
				<p className="text-sm text-muted">This state has no task instructions.</p>
			</>
		);
	}
	if (instructions.kind === "unavailable") {
		return (
			<>
				<p className="explorer-instruction-source">Instruction preview unavailable</p>
				<p className="text-sm text-muted">{instructions.message}</p>
			</>
		);
	}
	let source = "Instruction preview · saved actor context";
	if (simulated) {
		source = "Instruction preview · simulated context";
	}
	if (instructions.kind === "frozen") {
		source = `Published task instructions · ${instructions.bead}`;
	}
	return (
		<>
			<p className="explorer-instruction-source">{source}</p>
			<h2>{instructions.title}</h2>
			<WorkflowDispatch instruction={instructions} />
			<MarkdownContent>{instructions.instructions}</MarkdownContent>
		</>
	);
}
