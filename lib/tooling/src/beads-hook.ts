import { resolveEnvironment, runCommand } from "./beads-environment.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Claude requires appending to its shell environment file.
import { appendFile } from "node:fs/promises";
import { z } from "zod";

const inputSchema = z.object({
	cwd: z.string(),
	hook_event_name: z.literal("SessionStart"),
});

export async function runSessionStart(): Promise<void> {
	const { cwd } = inputSchema.parse(JSON.parse(await Bun.stdin.text()));
	const root = await runCommand(["git", "rev-parse", "--show-toplevel"], cwd);
	const environment = await resolveEnvironment(root, runCommand);
	const database = environment.BEADS_DB.replaceAll("'", String.raw`'\''`);
	await appendFile(
		z.string().parse(process.env.CLAUDE_ENV_FILE),
		`export BEADS_DB='${database}'\n`,
	);
}

if (import.meta.main) {
	await runSessionStart();
}
