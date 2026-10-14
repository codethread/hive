/** Render communication guidance; the caller chooses the producing run or stage. */
export function renderResponseInstructions({ taskId }: { taskId: string }): string {
	return (
		`Publish your complete authored response with bee response publish ${taskId} ` +
		"--body-file FILE --json, then verify it with bee response get RESPONSE_ID --json. " +
		"For blocked work, publish and verify a blocker report against the same target. " +
		"Put concise progress and verification evidence, including response IDs, in task comments. " +
		"Workflow notes contain only the original machine {choice,data}; keep response prose in " +
		"the filed response. Response records are closed linked docs, never executable child tasks."
	);
}
