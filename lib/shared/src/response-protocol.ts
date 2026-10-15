/** Identify the delivery target for a workflow visit or managed execution. */
export function renderResponseInstructions({ taskId }: { taskId: string }): string {
	return (
		`File and verify your complete answer or blocker against ${taskId}. ` +
		"Read bee response --help for delivery and correction instructions."
	);
}
