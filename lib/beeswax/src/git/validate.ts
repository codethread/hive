import type { WorkspaceIO } from "../services.ts";
import { parseJsonl } from "./jsonl.ts";

/** Validate the staged artifact, which can differ from the live exported snapshot. */
export async function validateStagedSnapshot(
	cwd: string,
	command: WorkspaceIO["command"],
): Promise<void> {
	const contents = await command(["git", "show", ":.beads/issues.jsonl"], cwd);
	const result = parseJsonl(contents, "staged .beads/issues.jsonl");
	if (result.kind === "invalid") {
		throw new Error(result.message);
	}
}
