import type { ExampleWorkflow } from "./workflow-examples.ts";
import { WorkflowDiagram } from "../workflow-diagram.tsx";
import { exampleInspection } from "./workflow-examples.ts";
import { preferences } from "../data.ts";
import { useMemo } from "react";
import { useStore } from "zustand";

export function WorkflowExamples({ workflow }: { workflow: ExampleWorkflow }) {
	const inspection = useMemo(() => exampleInspection(workflow), [workflow]);
	const theme = useStore(preferences, (state) => state.theme);
	return (
		<div className="flex h-dvh flex-col">
			<WorkflowDiagram
				key={workflow}
				inspection={inspection}
				colony="examples"
				theme={theme === "paper" ? "light" : "dark"}
			/>
		</div>
	);
}
