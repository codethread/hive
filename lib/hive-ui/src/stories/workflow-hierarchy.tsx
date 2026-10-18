import { useMemo, useState } from "react";
import { workflowActorGraph, workflowScopeSummary } from "../workflow-graph.ts";
import type { HierarchyPosition } from "./workflow-hierarchy-model.ts";
import { WorkflowCanvas } from "../workflow-canvas.tsx";
import { hierarchyInspection } from "./workflow-hierarchy-model.ts";
import { preferences } from "../data.ts";
import { useStore } from "zustand";

const LAST = -1;
const POSITIONS = ["mixed", "api-done", "handoff"] as const;

export function WorkflowHierarchyStress() {
	const [position, setPosition] = useState<HierarchyPosition>("mixed");
	const { graph } = useMemo(() => workflowActorGraph(hierarchyInspection().actors[0]!), []);
	const { current } = useMemo(
		() => workflowActorGraph(hierarchyInspection(position).actors[0]!),
		[position],
	);
	const [selection, setSelection] = useState({ step: current.at(LAST)! });
	const theme = useStore(preferences, (state) => state.theme);
	return (
		<main className="workflow-explorer flex-col">
			<header className="explorer-toolbar">
				<h1>Hierarchy stress</h1>
				<label>
					Snapshot{" "}
					<select
						aria-label="Example snapshot"
						value={position}
						onChange={(event) => {
							setPosition(POSITIONS.find((entry) => entry === event.target.value)!);
						}}
					>
						<option value="mixed">Mixed progress</option>
						<option value="api-done">API finished</option>
						<option value="handoff">Handoff</option>
					</select>
				</label>
				<span>50 states · 2 parallel scopes · fictional snapshots</span>
			</header>
			<div className="explorer-canvas">
				<WorkflowCanvas
					identity="hierarchy-stress"
					graph={graph}
					current={current}
					available={[]}
					availableLabel="Direct target"
					selected={selection.step}
					focusSelection={selection}
					theme={theme === "paper" ? "light" : "dark"}
					onInspect={(step) => {
						setSelection({ step });
					}}
				/>
			</div>
			<output className="explorer-toolbar">
				{graph.steps[selection.step]!.title} ·{" "}
				{workflowScopeSummary(graph, selection.step, current)}
			</output>
		</main>
	);
}
