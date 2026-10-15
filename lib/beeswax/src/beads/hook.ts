import type { Command, TrackerEnvironment } from "./environment.ts";
import { z } from "zod";

const inputSchema = z.object({
	cwd: z.string(),
	hook_event_name: z.literal("SessionStart"),
});

export interface SessionStartServices {
	/** Resolve the Git root through the command boundary. */
	command: Command;
	/** Resolve the same selected endpoint used by the public environment command. */
	environment: (root: string) => Promise<TrackerEnvironment>;
	/** Append shell exports to the harness-provided environment file. */
	append: (path: string, contents: string) => Promise<void>;
}

export async function runSessionStart(
	input: unknown,
	environmentFile: string,
	services: SessionStartServices,
): Promise<void> {
	const { cwd } = inputSchema.parse(input);
	const root = await services.command(["git", "rev-parse", "--show-toplevel"], cwd);
	const environment = await services.environment(root);
	await services.append(environmentFile, renderShellEnvironment(environment.BEADS_DB));
}

export function renderShellEnvironment(database: string): string {
	const escaped = database.replaceAll("'", String.raw`'\''`);
	return `export BEADS_DB='${escaped}'\n`;
}
