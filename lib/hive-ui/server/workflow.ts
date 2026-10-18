import { workflowLifecycleSchema, workflowSimulationSchema } from "@hive/shared";
import type { Colony } from "../contracts.ts";
import { CommandError } from "@hive/beads";
import type { WorkflowSimulationRequest } from "@hive/shared";
import { workflowViewSchema } from "../contracts.ts";
import { z } from "zod";

const resultSchema = z.compile(
	workflowViewSchema.extend({
		ok: z.literal(true),
		kind: z.literal("workflow_lifecycle"),
	}),
);
const errorSchema = z.compile(z.object({ ok: z.literal(false), message: z.string() }));
const lifecycleResultSchema = z.compile(
	workflowLifecycleSchema.extend({ ok: z.literal(true), kind: z.literal("workflow_lifecycle") }),
);
const simulationResultSchema = z.compile(
	workflowSimulationSchema.extend({ ok: z.literal(true), kind: z.literal("workflow_simulation") }),
);

/** The server selects the repository/database; browser input identifies the run and replay. */
export function createWorkflowTools(execute: (argv: string[], cwd: string) => Promise<string>) {
	const read = async <Value>(
		colony: Colony,
		args: string[],
		schema: z.ZodType<Value>,
	): Promise<Value> => {
		let output = "";
		try {
			output = await execute(
				["busybee", "--repo", colony.root, "--db", colony.beadsDb, ...args, "--json"],
				colony.root,
			);
		} catch (error) {
			if (error instanceof CommandError && error.stdout.trim() !== "") {
				throw new Error(errorSchema.parse(JSON.parse(error.stdout)).message, { cause: error });
			}
			throw error;
		}
		return schema.parse(JSON.parse(output));
	};
	return {
		lifecycle: async (colony: Colony, runId: string) => {
			const {
				ok: _ok,
				kind: _kind,
				...lifecycle
			} = await read(colony, ["inspect", runId], lifecycleResultSchema);
			return lifecycle;
		},
		preview: async (colony: Colony, runId: string) => {
			const {
				ok: _ok,
				kind: _kind,
				...preview
			} = await read(colony, ["inspect", runId, "--diagram", "--instructions"], resultSchema);
			return preview;
		},
		simulate: async (colony: Colony, runId: string, request: WorkflowSimulationRequest) => {
			const {
				ok: _ok,
				kind: _kind,
				...simulation
			} = await read(
				colony,
				["system", "simulate", runId, "--request", JSON.stringify(request)],
				simulationResultSchema,
			);
			return simulation;
		},
	};
}
