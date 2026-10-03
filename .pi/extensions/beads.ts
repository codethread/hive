import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

const environmentSchema = z.strictObject({
	BEADS_DB: z.string(),
	HIVE_BR_BIN: z.string(),
	PATH: z.string(),
});
const successExitCode = 0;

const beadsExtension = (pi: ExtensionAPI): void => {
	const command = async (executable: string, args: string[], cwd: string): Promise<string> => {
		const { stdout, stderr, code } = await pi.exec(executable, args, { cwd });
		if (code !== successExitCode) {
			throw new Error(`${stdout}${stderr}`.trim());
		}
		return stdout.trim();
	};

	pi.on("session_start", async (_event, ctx) => {
		try {
			const cwd = await command("git", ["rev-parse", "--show-toplevel"], ctx.cwd);
			const output = await command("bun", ["run", "beads:env", "--json"], cwd);
			Object.assign(process.env, environmentSchema.parse(JSON.parse(output)));
			await command("bun", ["run", "beads:sync"], cwd);
		} catch (error) {
			ctx.ui.notify(String(error), "error");
		}
	});

	pi.on("tool_call", async (_event, ctx) => {
		try {
			const cwd = await command("git", ["rev-parse", "--show-toplevel"], ctx.cwd);
			await command("bun", ["run", "beads:health"], cwd);
			return { block: false };
		} catch (error) {
			return {
				block: true,
				reason: `Beads synchronization blocked tool work. ${String(error)}\nAsk the human to resolve the reported tracker problem and run bun run beads:sync from a separate terminal before continuing.`,
			};
		}
	});
};

// Pi discovers extensions through its required default factory export.
export { beadsExtension as default };
