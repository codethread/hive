import type { WorkflowInspection } from "../contracts.ts";

type Instruction = WorkflowInspection["actors"][number]["instructions"][string];

export function WorkflowDispatch({ instruction }: { instruction: Instruction }) {
	if (instruction.kind !== "frozen" && instruction.kind !== "rendered") {
		return null;
	}
	if (!instruction.bee) {
		return null;
	}
	return (
		<p className="text-sm text-muted">
			{instruction.kind === "frozen" ? (
				<>
					Bee kind: {instruction.bee.kind} · Original published request:{" "}
					<code>{instruction.bee.request}</code>
				</>
			) : (
				<>Authored dispatch preview · Bee kind: {instruction.bee.kind}</>
			)}
		</p>
	);
}
