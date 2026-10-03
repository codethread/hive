// oxlint-disable-next-line import/no-nodejs-modules -- Claude requires appending to its shell environment file.
import { appendFile } from "node:fs/promises";
import { z } from "zod";

const environmentSchema = z.strictObject({
	BEADS_DB: z.string(),
	HIVE_BR_BIN: z.string(),
	PATH: z.string(),
});
const eventSchema = z.enum(["SessionStart", "PreToolUse"]);
const harnessSchema = z.enum(["claude", "codex"]);
const inputSchema = z.object({ cwd: z.string(), hook_event_name: eventSchema });
const successExitCode = 0;
const harnessArgumentIndex = 2;
const eventArgumentIndex = 3;

const command = async (args: string[], cwd: string): Promise<string> => {
	const child = Bun.spawn(args, { cwd, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== successExitCode) {
		throw new Error(`${stdout}${stderr}`.trim());
	}
	return stdout.trim();
};

const configureEnvironment = async (cwd: string): Promise<void> => {
	const output = await command(["bun", "run", "beads:env", "--json"], cwd);
	const environment = environmentSchema.parse(JSON.parse(output));
	const exports = Object.entries(environment).map(
		([key, value]) => `export ${key}='${value.replaceAll("'", String.raw`'\''`)}'`,
	);
	await appendFile(z.string().parse(process.env.CLAUDE_ENV_FILE), `${exports.join("\n")}\n`);
};

const reportFailure = (event: z.infer<typeof eventSchema>, error: unknown): void => {
	const reason = `Beads synchronization blocked tool work. ${String(error)}\nAsk the human to resolve the reported tracker problem and run bun run beads:sync from a separate terminal before continuing.`;
	if (event === "PreToolUse") {
		console.log(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: event,
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			}),
		);
	} else {
		console.log(
			JSON.stringify({
				hookSpecificOutput: { additionalContext: reason, hookEventName: event },
				systemMessage: reason,
			}),
		);
	}
};

const resolveProject = async (event: z.infer<typeof eventSchema>): Promise<string> => {
	const { cwd, hook_event_name: receivedEvent } = inputSchema.parse(
		JSON.parse(await Bun.stdin.text()),
	);
	if (receivedEvent !== event) {
		throw new Error(`Expected ${event} hook input; received ${receivedEvent}.`);
	}
	return command(["git", "rev-parse", "--show-toplevel"], cwd);
};

const runNativeHook = async (
	harness: z.infer<typeof harnessSchema>,
	event: z.infer<typeof eventSchema>,
): Promise<void> => {
	try {
		const cwd = await resolveProject(event);
		if (event === "SessionStart") {
			if (harness === "claude") {
				await configureEnvironment(cwd);
			}
			await command(["bun", "run", "beads:sync"], cwd);
		} else {
			await command(["bun", "run", "beads:health"], cwd);
		}
	} catch (error) {
		reportFailure(event, error);
	}
};

if (import.meta.main) {
	await runNativeHook(
		harnessSchema.parse(process.argv[harnessArgumentIndex]),
		eventSchema.parse(process.argv[eventArgumentIndex]),
	);
}

export { runNativeHook };
