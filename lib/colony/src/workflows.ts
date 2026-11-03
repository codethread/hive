import { workflowLifecycleSchema, workflowRunInspectionSchema } from "@hive/shared";
import { CommandError } from "@hive/beads";
import type { WorkflowLifecycle } from "@hive/shared";
import { z } from "zod";

const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const visitSchema = z.object({ bead: text, request: text.nullable() });
const runSchema = z.object({
	id: text,
	status: text,
	active: z.array(visitSchema),
});
const workInspectionSchema = workflowRunInspectionSchema.required({ work: true });
const handoffSchema = z.object({ runId: text, status: text, checkpoint: text });
const failureSchema = z
	.object({
		ok: z.literal(false),
		reason: text,
		message: text,
	})
	.passthrough();

export interface WorkflowEndpoint {
	/** Checkout supplying definitions and workflow execution. */
	repo: string;
	/** Selected native tracker, independent of checkout. */
	db: string;
	/** Audit actor for Busybee mutations. */
	actor: string;
}
export type WorkflowSelection = { kind: "named"; name: string } | { kind: "source"; path: string };
export type WorkflowRun = z.infer<typeof runSchema>;
export type WorkflowHandoff = z.infer<typeof handoffSchema>;
export interface WorkflowCommands {
	/** Observe native lifecycle and publication fences without loading a definition. */
	inspect: (runId: string, endpoint: WorkflowEndpoint) => Promise<WorkflowLifecycle>;
	/** Validate caller input and initialize one durable workflow. */
	start: (input: {
		parent: string;
		selection: WorkflowSelection;
		inputFile: string;
		owner: string;
		endpoint: WorkflowEndpoint;
	}) => Promise<WorkflowRun>;
	/** Inspect the saved frontier without changing workflow state. */
	work: (runId: string, endpoint: WorkflowEndpoint) => Promise<WorkflowRun>;
	/** Busybee owns readiness and preparation of an existing active run. */
	advance: (
		request: { runId: string; mode: "prepare-driver" },
		endpoint: WorkflowEndpoint,
	) => Promise<WorkflowHandoff>;
}
export interface WorkflowProcess {
	/** Captured subprocess transport, supplied by the executable composition root. */
	execute: (argv: string[], cwd: string) => Promise<string>;
}

/** Translate the Busybee command contract once at the process boundary. */
export function workflowCommands(process: WorkflowProcess): WorkflowCommands {
	return {
		inspect: async (runId, endpoint) =>
			workflowLifecycleSchema.parse(await invoke(["inspect", runId], endpoint, process)),
		start: async ({ parent, selection, inputFile, owner, endpoint }) => {
			const command = startArguments(selection);
			return runSchema.parse(
				await invoke(
					[
						...command,
						"--parent",
						parent,
						"--input-file",
						inputFile,
						"--owner",
						owner,
						"--assignee",
						"",
					],
					endpoint,
					process,
				),
			);
		},
		work: async (runId, endpoint) => {
			const inspection = workInspectionSchema.parse(
				await invoke(["inspect", runId, "--work"], endpoint, process),
			);
			const expansion = inspection.work;
			if (expansion.kind === "unavailable") {
				throw new WorkflowCommandError(
					{ ok: false, reason: expansion.reason, message: expansion.message, ...expansion.context },
					inspection,
				);
			}
			return runSchema.parse(expansion.data);
		},
		advance: async ({ runId }, endpoint) =>
			handoffSchema.parse(await invoke(["advance", runId, "--prepare-driver"], endpoint, process)),
	};
}

export class WorkflowCommandError extends Error {
	/** The Busybee failure document, including known partial effects. */
	readonly context: Record<string, unknown>;
	/** Stable Busybee failure reason. */
	readonly reason: string;
	constructor(document: z.infer<typeof failureSchema>, cause: unknown) {
		super(document.message, { cause });
		this.name = "WorkflowCommandError";
		const { ok: _ok, kind: _kind, message: _message, reason, ...context } = document;
		this.reason = reason;
		this.context = context;
	}
}

// --- Private functions ---
function startArguments(selection: WorkflowSelection): string[] {
	if (selection.kind === "named") {
		return ["run", selection.name];
	}
	return ["start", selection.path];
}

async function invoke(
	argv: string[],
	endpoint: WorkflowEndpoint,
	process: WorkflowProcess,
): Promise<unknown> {
	try {
		const output = await process.execute(
			[
				"busybee",
				"--repo",
				endpoint.repo,
				"--db",
				endpoint.db,
				"--actor",
				endpoint.actor,
				"--json",
				...argv,
			],
			endpoint.repo,
		);
		return z
			.object({ ok: z.literal(true) })
			.passthrough()
			.parse(JSON.parse(output));
	} catch (error) {
		if (error instanceof CommandError && error.stdout.trim() !== "") {
			throw new WorkflowCommandError(failureSchema.parse(JSON.parse(error.stdout)), error);
		}
		throw error;
	}
}
