import { resolveEnvironment, runCommand } from "./beads-environment.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Claude requires appending to its shell environment file.
import { appendFile } from "node:fs/promises";
import { z } from "zod";

const harnessSchema = z.enum(["claude", "codex"]);
const inputSchema = z.object({
	cwd: z.string(),
	hook_event_name: z.literal("SessionStart"),
});
const harnessArgumentIndex = 2;

const runSessionStart = async (harness: z.infer<typeof harnessSchema>): Promise<void> => {
	const { cwd } = inputSchema.parse(JSON.parse(await Bun.stdin.text()));
	const root = await runCommand(["git", "rev-parse", "--show-toplevel"], cwd);
	const environment = await resolveEnvironment(root, runCommand);
	if (harness === "claude") {
		const database = environment.BEADS_DB.replaceAll("'", String.raw`'\''`);
		await appendFile(
			z.string().parse(process.env.CLAUDE_ENV_FILE),
			`export BEADS_DB='${database}'\n`,
		);
	}
	await runCommand(["bun", "run", "beads:sync"], root);
};

if (import.meta.main) {
	await runSessionStart(harnessSchema.parse(process.argv[harnessArgumentIndex]));
}

export { runSessionStart };
