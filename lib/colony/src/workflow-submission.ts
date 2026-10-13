/* eslint-disable import/no-nodejs-modules --
 * Paths and filesystem validation are owned by the application I/O boundary.
 */
import type { ProducerCommands, SpawnResult } from "./producer.ts";
import { SPAWN_REQUEST_LABELS, readSpawnRequestSummary, recipeSchema } from "@hive/shared";
import type {
	WorkflowCommands,
	WorkflowEndpoint,
	WorkflowRun,
	WorkflowSelection,
} from "./workflows.ts";
import type { SpawnOptions } from "./bee-cli.ts";
import { WorkflowCommandError } from "./workflows.ts";
import { resolve } from "node:path";
import { spawnWorkflowRequest } from "./producer.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const NONEMPTY = 1;
const NONE = 0;
const actorSchema = z.compile(z.string().trim().min(NONEMPTY));

export interface WorkflowSpawnOptions extends SpawnOptions {
	/** Caller-owned JSON input, validated by the selected workflow. */
	inputFile: string;
	/** Named workflow override from the execution checkout. */
	workflow?: string;
	/** Explicit trusted workflow source, mutually exclusive with a name. */
	source?: string;
}
export interface StageOptions extends SpawnOptions {
	/** Existing workflow containing this automatic visit. */
	run: string;
}
export interface WorkflowSubmissionCommands extends ProducerCommands {
	/** Busybee's public process contract, injected for composition tests. */
	workflows: WorkflowCommands;
	/** Invoking directory for source and input paths. */
	cwd: string;
	/** Validate and canonicalize the selected execution directory at the I/O boundary. */
	executionDirectory: (directory: string) => Promise<string>;
	/** Native reservation and duplicate admission, before handoff mutation. */
	admit: (runId: string, options: SpawnOptions) => Promise<void>;
}
export interface WorkflowSubmissionResult {
	/** Initialization and driver request publication completed; execution is separate. */
	kind: "workflow_spawn_created";
	/** Driver identity used to inspect execution. */
	request: { id: string; identity: string };
	/** Durable assignment and completion anchor. */
	workflow: { runId: string; status: string };
}

/** Create one workflow assignment and delegate its existing run to Colony. */
export async function submitWorkflow(
	kind: string,
	options: WorkflowSpawnOptions,
	commands: WorkflowSubmissionCommands,
): Promise<WorkflowSubmissionResult> {
	const { endpoint, owner, workflow } = await submissionContext(kind, options, commands);
	if (options.workflow !== undefined && options.source !== undefined) {
		throw new WorkflowSubmissionError("conflicting_workflow", "Choose --workflow or --source.", {});
	}
	let selection: WorkflowSelection = { kind: "named", name: options.workflow ?? workflow };
	if (options.source !== undefined) {
		selection = { kind: "source", path: resolve(commands.cwd, options.source) };
	}
	const run = await commands.workflows.start({
		endpoint,
		owner,
		selection,
		inputFile: resolve(commands.cwd, options.inputFile),
	});
	return attachPrepared({ kind, run, endpoint, options }, commands);
}

/** Attach to a confirmed orphan run without creating or replaying a workflow. */
export async function attachWorkflow(
	{ kind, runId, options }: { kind: string; runId: string; options: SpawnOptions },
	commands: WorkflowSubmissionCommands,
): Promise<WorkflowSubmissionResult> {
	const { endpoint } = await submissionContext(kind, options, commands);
	await assertOrphanRun(runId, endpoint, commands);
	await commands.admit(runId, options);
	const run = await commands.workflows.show(runId, endpoint);
	return attachPrepared({ kind, run, endpoint, options }, commands);
}

/** Execute an existing automatic visit without selecting or creating a workflow. */
export async function dispatchStage(
	{ kind, stageId, options }: { kind: string; stageId: string; options: StageOptions },
	commands: WorkflowSubmissionCommands,
): Promise<SpawnResult> {
	const { endpoint } = await submissionContext(kind, options, commands);
	await assertStageParent({ stageId, runId: options.run, endpoint }, commands);
	return spawnWorkflowRequest(
		{
			kind,
			assignment: { kind: "stage", runId: options.run, stageId },
			options,
		},
		commands,
	);
}

export class WorkflowSubmissionError extends Error {
	/** Machine-readable workflow submission failure. */
	readonly reason: string;
	/** Confirmed effects and publication uncertainty for the next inspection. */
	readonly context: Record<string, unknown>;
	// Error reason, diagnostic, confirmed effects and original cause are independent failure facts.
	// eslint-disable-next-line max-params
	constructor(reason: string, message: string, context: Record<string, unknown>, cause?: unknown) {
		super(message, { cause });
		this.name = "WorkflowSubmissionError";
		this.reason = reason;
		this.context = context;
		if (cause instanceof WorkflowCommandError) {
			this.context = {
				...context,
				cause: { reason: cause.reason, message: cause.message, ...cause.context },
			};
		} else if (cause instanceof Error) {
			this.context = { ...context, cause: { message: cause.message } };
		}
	}
}

// --- Private functions ---

async function assertOrphanRun(
	runId: string,
	endpoint: WorkflowEndpoint,
	commands: WorkflowSubmissionCommands,
): Promise<void> {
	const scope = trackerScope({ root: endpoint.repo, beadsDb: endpoint.db }, endpoint.actor);
	const run = await commands.beads.show(scope, runId);
	const ids = run.dependents
		.filter((edge) => edge.dependency_type === "related")
		.map((edge) => edge.id);
	if (ids.length === NONE) {
		return;
	}
	const requests = await commands.beads.list(scope, {
		ids,
		labels: SPAWN_REQUEST_LABELS,
		all: true,
		limit: 0,
	});
	const driver = requests.issues.find((request) => {
		const { assignment } = readSpawnRequestSummary(request);
		return assignment.kind === "driver" && assignment.runId === runId;
	});
	if (driver) {
		throw new WorkflowSubmissionError(
			"driver_exists",
			"Workflow " +
				`${runId}` +
				" already has driver request " +
				`${driver.id}` +
				"; inspect it or retry an eligible failed request.",
			{
				runId,
				requestId: driver.id,
				requestStatus: driver.status,
			},
		);
	}
}

async function submissionContext(
	kind: string,
	options: SpawnOptions,
	commands: WorkflowSubmissionCommands,
) {
	actorSchema.parse(options.actor);
	const repository = await commands.resolveRepository(options.repo, options.beadsDb);
	const { config } = await commands.loadBeesConfig(repository.root);
	const defaults = config.kinds[kind];
	if (!defaults) {
		throw new WorkflowSubmissionError("unknown_kind", `Unknown bee kind ${kind}.`, {
			beeKind: kind,
		});
	}
	const repo = await commands.executionDirectory(
		resolve(commands.cwd, options.cwd ?? repository.root),
	);
	// Fail before initialization when caller overrides cannot form an execution recipe.
	recipeSchema.parse({
		cwd: repo,
		kind,
		effort: options.effort ?? defaults.effort,
		harness: options.harness ?? defaults.harness,
		model: options.model ?? defaults.model,
		prompt: options.prompt ?? defaults.prompt,
		system_prompt: options.systemPrompt ?? defaults.system_prompt,
	});
	const endpoint: WorkflowEndpoint = { actor: options.actor, db: repository.beadsDb, repo };
	return { endpoint, owner: config.owner, workflow: defaults.workflow };
}

// Validate the supplied stage and traverse its native parent lineage in one read-only boundary.
// eslint-disable-next-line max-statements
async function assertStageParent(
	{ stageId, runId, endpoint }: { stageId: string; runId: string; endpoint: WorkflowEndpoint },
	commands: WorkflowSubmissionCommands,
): Promise<void> {
	const scope = trackerScope({ root: endpoint.repo, beadsDb: endpoint.db }, endpoint.actor);
	let task = await commands.beads.show(scope, stageId);
	if (stageId === runId || task.status === "closed") {
		throw new WorkflowSubmissionError("closed_stage", `Stage ${stageId} is already closed.`, {
			runId,
			stageId,
		});
	}
	// Initial automatic dispatch occurs before Busybee saves the published frontier.
	// Native parentage is available here; reading the checkpoint frontier would be stale.
	while (task.id !== runId) {
		const parent = task.dependencies.find((edge) => edge.dependency_type === "parent-child");
		if (!parent) {
			throw new WorkflowSubmissionError(
				"unrelated_stage",
				`Stage ${stageId} is not beneath workflow ${runId}.`,
				{ runId, stageId },
			);
		}
		// eslint-disable-next-line no-await-in-loop -- Each ancestor read identifies the next native parent.
		task = await commands.beads.show(scope, parent.id);
	}
	if (task.status === "closed") {
		throw new WorkflowSubmissionError("closed_workflow", `Workflow ${runId} is already closed.`, {
			runId,
			stageId,
		});
	}
}

async function attachPrepared(
	{
		kind,
		run,
		endpoint,
		options,
	}: { kind: string; run: WorkflowRun; endpoint: WorkflowEndpoint; options: SpawnOptions },
	commands: WorkflowSubmissionCommands,
): Promise<WorkflowSubmissionResult> {
	const context = {
		runId: run.id,
		stageRequestIds: run.active.flatMap((entry) => {
			if (entry.request === null) {
				return [];
			}
			return [entry.request];
		}),
	};
	if (run.status === "done") {
		throw new WorkflowSubmissionError(
			"workflow_already_done",
			`Workflow ${run.id} completed during initialization; no driver was created.`,
			{ ...context, driverPublication: "not_attempted" },
		);
	}
	const handoff = await prepareDriver({ run, endpoint, context }, commands);
	if (handoff.status !== "active") {
		throw new WorkflowSubmissionError(
			"workflow_already_done",
			`Workflow ${run.id} is ${handoff.status}; no driver was created.`,
			{ ...context, driverPublication: "not_attempted" },
		);
	}
	try {
		const { request } = await spawnWorkflowRequest(
			{ kind, assignment: { kind: "driver", runId: run.id }, options },
			commands,
		);
		return {
			kind: "workflow_spawn_created",
			request: { id: request.id, identity: request.assignee },
			workflow: { runId: run.id, status: handoff.status },
		};
	} catch (error) {
		throw new WorkflowSubmissionError(
			"workflow_driver_failed",
			"Workflow " +
				`${run.id}` +
				" exists; driver publication did not complete. Inspect related requests before " +
				"using attach-workflow.",
			{ ...context, checkpoint: handoff.checkpoint, driverPublication: "uncertain" },
			error,
		);
	}
}

async function prepareDriver(
	{
		run,
		endpoint,
		context,
	}: { run: WorkflowRun; endpoint: WorkflowEndpoint; context: Record<string, unknown> },
	commands: WorkflowSubmissionCommands,
) {
	try {
		return await commands.workflows.prepareDriver(run.id, endpoint);
	} catch (error) {
		throw new WorkflowSubmissionError(
			"workflow_handoff_failed",
			`Workflow ${run.id} exists but driver preparation failed. Inspect it before attaching a driver.`,
			{ ...context, driverPublication: "not_attempted" },
			error,
		);
	}
}
