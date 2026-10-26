import { CommandError } from "@hive/beads";
import { z } from "zod";

const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const visitSchema = z.object({ bead: text, request: text.nullable() });
const projectionFields = {
	chartStatus: text,
	completion: z.enum(["pending", "projection_pending", "succeeded", "failed", "cancelled"]),
	nativeStatus: text,
};
const runSchema = z.object({
	...projectionFields,
	id: text,
	status: text,
	active: z.array(visitSchema),
});
const handoffSchema = z.object({
	...projectionFields,
	runId: text,
	status: text,
	checkpoint: text,
});
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
	/** Validate caller input and initialize one durable workflow. */
	start: (input: {
		parent: string;
		selection: WorkflowSelection;
		inputFile: string;
		owner: string;
		endpoint: WorkflowEndpoint;
	}) => Promise<WorkflowRun>;
	/** Inspect the saved frontier without changing workflow state. */
	show: (runId: string, endpoint: WorkflowEndpoint) => Promise<WorkflowRun>;
	/** Busybee owns readiness and preparation of an existing active run. */
	prepareDriver: (runId: string, endpoint: WorkflowEndpoint) => Promise<WorkflowHandoff>;
}
export interface WorkflowProcess {
	/** Captured subprocess transport, supplied by the executable composition root. */
	execute: (argv: string[], cwd: string) => Promise<string>;
}

/** Translate the Busybee command contract once at the process boundary. */
export function workflowCommands(process: WorkflowProcess): WorkflowCommands {
	return {
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
		show: async (runId, endpoint) =>
			runSchema.parse(await invoke(["show", runId], endpoint, process)),
		prepareDriver: async (runId, endpoint) =>
			handoffSchema.parse(await invoke(["system", "prepare-driver", runId], endpoint, process)),
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
