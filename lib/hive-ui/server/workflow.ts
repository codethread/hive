import type { Colony } from "../contracts.ts";
import { CommandError } from "@hive/beads";
import { workflowPreviewSchema } from "@hive/shared";
import { z } from "zod";

const resultSchema = z.compile(
	workflowPreviewSchema.extend({
		ok: z.literal(true),
		kind: z.literal("workflow_preview"),
	}),
);
const errorSchema = z.compile(z.object({ ok: z.literal(false), message: z.string() }));

/** The caller selects an allowlisted endpoint; browser input supplies only a bead identity. */
export function createWorkflowReader(execute: (argv: string[], cwd: string) => Promise<string>) {
	return async (colony: Colony, runId: string) => {
		let output = "";
		try {
			output = await execute(
				["busybee", "--repo", colony.root, "--db", colony.beadsDb, "preview", runId, "--json"],
				colony.root,
			);
		} catch (error) {
			if (error instanceof CommandError && error.stdout.trim() !== "") {
				throw new Error(errorSchema.parse(JSON.parse(error.stdout)).message, { cause: error });
			}
			throw error;
		}
		const { ok: _ok, kind: _kind, ...preview } = resultSchema.parse(JSON.parse(output));
		return preview;
	};
}
