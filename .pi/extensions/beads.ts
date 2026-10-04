import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

const environmentSchema = z.strictObject({
	BEADS_DB: z.string(),
});
const successExitCode = 0;
const statusKey = "beads";
const claimedBeadsSchema = z.array(
	z.object({ id: z.string().regex(/^[\w.-]+$/u), status: z.literal("in_progress") }),
);

export function claimedBead(event: ToolResultEvent): string | undefined {
	const { command } = event.input;
	if (event.toolName !== "bash" || event.isError || typeof command !== "string") {
		return undefined;
	}
	// Ignore quoted argument values, such as notes mentioning --claim.
	const unquotedCommand = command.replaceAll(/'[^']*'|"(?:\\.|[^"\\])*"/gu, "");
	if (!/\bbr\s+[^\n]*\bupdate\b[^\n]*\s--claim(?:\s|$)/u.test(unquotedCommand)) {
		return undefined;
	}
	const output = event.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	try {
		return claimedBeadsSchema.safeParse(JSON.parse(output)).data?.pop()?.id;
	} catch {
		// Only br's JSON update response is evidence of a successful claim.
		return undefined;
	}
}

// Pi discovers extensions through its required default factory export.
export default function beadsExtension(pi: ExtensionAPI): void {
	const command = async (executable: string, args: string[], cwd: string): Promise<string> => {
		const { stdout, stderr, code } = await pi.exec(executable, args, { cwd });
		if (code !== successExitCode) {
			throw new Error(`${stdout}${stderr}`.trim());
		}
		return stdout.trim();
	};

	pi.on("tool_result", (event, ctx) => {
		const id = claimedBead(event);
		if (id) {
			ctx.ui.setStatus(statusKey, `bead: ${id}`);
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus(statusKey, undefined);
		try {
			const cwd = await command("git", ["rev-parse", "--show-toplevel"], ctx.cwd);
			const output = await command("bun", ["run", "beads:env", "--json"], cwd);
			Object.assign(process.env, environmentSchema.parse(JSON.parse(output)));
			await command("bun", ["run", "beads:sync"], cwd);
		} catch (error) {
			ctx.ui.notify(String(error), "error");
		}
	});
}
