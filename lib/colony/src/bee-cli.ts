/* eslint-disable import/max-dependencies --
 * CLI composes request, workflow submission, advisory and inspection result contracts.
 */
import type {
	AcknowledgmentResult,
	RequestListResult,
	RequestResult,
	RequestView,
} from "./requests.ts";
import type { KindOptions, KindsResult } from "./kinds.ts";
import type {
	StageOptions,
	WorkflowSpawnOptions,
	WorkflowSubmissionResult,
} from "./workflow-submission.ts";
import type { AssessmentSubmission } from "./postrun.ts";
import { Command } from "commander";
import type { DroneReportResult } from "./drone.ts";
import type { FinishResult } from "./launch.ts";
import { HELP } from "./bee-help.ts";
import type { RunOptions } from "./run.ts";
import type { SpawnResult } from "./producer.ts";
import { kindsJsonSchema } from "./kinds.ts";
import { reportFailure } from "./cli.ts";
import { version } from "../package.json";

const SUCCESS = 0;
const JSON_INDENT = 2;
type BeeResult =
	| AcknowledgmentResult
	| AssessmentSubmission
	| RequestResult
	| RequestListResult
	| SpawnResult
	| WorkflowSubmissionResult
	| FinishResult
	| DroneReportResult
	| KindsResult;

export interface SpawnOptions {
	/** Repository discovery directory. */
	repo: string;
	/** Selected Beads endpoint. */
	beadsDb: string;
	/** Requester credited with creation. */
	actor: string;
	/** Override the kind's model. */
	model?: string;
	/** Override the kind's reasoning effort. */
	effort?: string;
	/** Name of the runtime formula, which may be installed later. */
	harness?: string;
	/** Execution directory; does not affect discovery or tracker. */
	cwd?: string;
	/** Override optional direction for this execution. */
	prompt?: string;
	/** Override the kind's reusable role and protocol. */
	systemPrompt?: string;
}
export interface RetryOptions extends SpawnOptions {
	/** Select current defaults from another kind. */
	kind?: string;
}
export interface InspectionOptions {
	/** Canonical repository discovery directory. */
	repo: string;
	/** Explicit tracker database; inspection does not need daemon state. */
	beadsDb: string;
}
export interface ListOptions extends InspectionOptions {
	/** Include closed requests as well as open ones. */
	all: boolean;
}
export interface StopOptions extends InspectionOptions {
	/** Actor attributed to the native request closure. */
	actor: string;
}
export interface AckOptions extends InspectionOptions {
	/** Actor accepting the failure; explicit flag overrides BD_ACTOR. */
	actor: string;
	/** Explanation of why this failure no longer needs attention. */
	reason: string;
}
export interface BeeDependencies {
	/** Hand the current terminal to a user-invoked interactive harness. */
	run: (kind: string, options: RunOptions) => Promise<void>;
	/** Submit one advisory assessment using injected execution authority. */
	assess: (file: string) => Promise<AssessmentSubmission>;
	/** Accept a failed request without changing its outcome or linked tasks. */
	ack: (id: string, options: AckOptions) => Promise<AcknowledgmentResult>;
	/** Discover configured kinds independently of the tracker and daemon. */
	kinds: (name: string | undefined, options: KindOptions) => Promise<KindsResult>;
	/** Submit one verdict for the injected drone review and exact inspected attempt. */
	report: (id: string, verdict: string) => Promise<DroneReportResult>;
	/** Submit an attempt-scoped self-report using injected provenance. */
	finish: (outcome: string, options: { reason?: string }) => Promise<FinishResult>;
	/** Read native request, task and last observation facts. */
	status: (id: string, options: InspectionOptions) => Promise<RequestResult>;
	/** Inspect requests in the explicitly selected tracker. */
	list: (options: ListOptions) => Promise<RequestListResult>;
	/** Close a validated request without daemon or process access. */
	stop: (id: string, options: StopOptions) => Promise<RequestResult>;
	/** Initialize one workflow assignment and submit its driver request. */
	spawn: (kind: string, options: WorkflowSpawnOptions) => Promise<WorkflowSubmissionResult>;
	/** Attach a driver to an existing run after inspecting partial submission. */
	attachWorkflow: (
		kind: string,
		runId: string,
		options: SpawnOptions,
	) => Promise<WorkflowSubmissionResult>;
	/** Internal Bee-dispatched stage execution without another workflow wrapper. */
	dispatchStage: (kind: string, stageId: string, options: StageOptions) => Promise<SpawnResult>;
	/** Replace an unsuccessful request from current kind defaults. */
	retry: (id: string, options: RetryOptions) => Promise<SpawnResult>;
	/** Write result and help. */
	stdout: (text: string) => void;
	/** Write diagnostics. */
	stderr: (text: string) => void;
}
// eslint-disable-next-line max-statements -- Declare the public offline request commands together.
export async function runBeeCli(argv: string[], deps: BeeDependencies): Promise<number> {
	const program = new Command()
		.name("bee")
		.version(version)
		.description("Delegate work to configured bees and inspect their requests")
		.addHelpText("after", HELP.overview)
		.option("--json", "Emit one JSON result or error")
		.configureOutput({ writeErr: () => {}, writeOut: deps.stdout })
		.exitOverride();
	program
		.command("run <kind>")
		.description("Open an interactive bee in this terminal (users only; agents must not run)")
		.option("--model <model>", "Override the kind's model")
		.option("--effort <effort>", "Override the kind's reasoning effort")
		.option("--harness <name>", "Select a named harness formula")
		.option("--prompt <text>", "Replace the initial user prompt")
		.option("--system-prompt <text>", "Replace the role instructions")
		.addHelpText("after", HELP.run)
		.action(async (kind: string, options: RunOptions) => {
			if (program.opts()["json"]) {
				throw new Error("bee run does not support --json; the harness owns terminal output");
			}
			await deps.run(kind, options);
		});
	program
		.command("kinds [kind]")
		.description("Discover available kinds and their selection guidance")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.option(
			"--as <kind>",
			"Caller perspective; overrides BR_AGENT_NAME",
			process.env["BR_AGENT_NAME"],
		)
		.option("--all", "Include hidden kinds and bypass caller visibility guidance", false)
		.option("--schema", "Print the JSON response schema without reading configuration", false)
		.option(
			"-v, --verbose",
			"Include full prompts, execution defaults and visibility settings",
			false,
		)
		.addHelpText("after", HELP.kinds)
		.action(async (name: string | undefined, options: KindOptions & { schema: boolean }) => {
			if (options.schema) {
				deps.stdout(
					`${JSON.stringify({ kind: "bee_kinds_schema", ok: true, schema: kindsJsonSchema(options.verbose) })}` +
						"\n",
				);
				return;
			}
			const result = await deps.kinds(name, options);
			const json = argv.includes("--json");
			if (!json) {
				for (const warning of result.warnings) {
					deps.stderr(`Warning: ${warning}\n`);
				}
			}
			writeResult(result, { json }, deps.stdout);
		});
	submissionOptions(
		program
			.command("spawn <kind>")
			.description("Create one workflow assignment and submit its driver")
			.addHelpText("after", HELP.spawn),
	)
		.requiredOption("--parent <id>", "Existing ordinary work containing the new workflow")
		.requiredOption(
			"--input-file <file>",
			"Caller workflow input as JSON; default: title, request, acceptance",
		)
		.option(
			"--workflow <name>",
			"Named workflow in the execution checkout; defaults to the kind workflow",
		)
		.option("--source <path>", "Explicit workflow definition instead of a catalogue name")
		.action(async (kind: string, options: WorkflowSpawnOptions) => {
			writeResult(await deps.spawn(kind, options), { json: argv.includes("--json") }, deps.stdout);
		});
	submissionOptions(
		program
			.command("attach-workflow <kind> <run>")
			.description("Attach a driver to a confirmed orphan workflow run; creates no new workflow"),
	).action(async (kind: string, runId: string, options: SpawnOptions) => {
		writeResult(
			await deps.attachWorkflow(kind, runId, options),
			{ json: argv.includes("--json") },
			deps.stdout,
		);
	});
	submissionOptions(
		program
			.command("dispatch-stage <kind> <stage>")
			.description(
				"Workflow integration: execute one existing Bee-dispatched stage without wrapping it",
			),
	)
		.requiredOption("--run <run>", "Existing workflow run containing the stage")
		.action(async (kind: string, stageId: string, options: StageOptions) => {
			writeResult(
				await deps.dispatchStage(kind, stageId, options),
				{ json: argv.includes("--json") },
				deps.stdout,
			);
		});
	submissionOptions(
		program
			.command("retry <spawn-id>")
			.description("Replace an unsuccessful request using current defaults and unfinished tasks")
			.addHelpText("after", HELP.retry),
	)
		.option("--kind <kind>", "Select another kind; defaults to the old request kind")
		.action(async (id: string, options: RetryOptions) => {
			writeResult(await deps.retry(id, options), { json: argv.includes("--json") }, deps.stdout);
		});
	program
		.command("finish <outcome>")
		.description("Report success or blocked work from this Colony execution")
		.addHelpText("after", HELP.finish)
		.option("--reason <text>", "Required durable blocker and next action for blocked")
		.action(async (outcome: string, options: { reason?: string }) => {
			writeResult(
				await deps.finish(outcome, options),
				{ json: argv.includes("--json") },
				deps.stdout,
			);
		});
	program
		.command("assess")
		.description("Submit a post-run advisory report under injected assessment authority")
		.requiredOption("--file <path>", "JSON report; contract: colony assessments --schema")
		.action(async (options: { file: string }) => {
			writeResult(await deps.assess(options.file), { json: argv.includes("--json") }, deps.stdout);
		});
	program
		.command("report <spawn-id> <verdict>")
		.description("Report active or inactive from this Colony inactivity drone")
		.addHelpText("after", HELP.report)
		.action(async (id: string, verdict: string) => {
			writeResult(await deps.report(id, verdict), { json: argv.includes("--json") }, deps.stdout);
		});
	inspectionOptions(
		program
			.command("status <spawn-id>")
			.description("Inspect request facts and timestamped last observations")
			.addHelpText("after", HELP.status),
	)
		.option("--include-prompt", "Include both full captured prompt fields in status output", false)
		.action(
			async (
				id: string,
				{ includePrompt, ...options }: InspectionOptions & { includePrompt: boolean },
			) => {
				writeResult(
					await deps.status(id, options),
					{ includePrompt, json: argv.includes("--json") },
					deps.stdout,
				);
			},
		);
	inspectionOptions(
		program
			.command("list")
			.description("List open requests and unresolved failures; observations may be stale")
			.addHelpText("after", HELP.list),
	)
		.option("--all", "Include resolved historical requests", false)
		.action(async (options: ListOptions) => {
			writeResult(await deps.list(options), { json: argv.includes("--json") }, deps.stdout);
		});
	inspectionOptions(
		program
			.command("ack <spawn-id>")
			.description("Acknowledge a failed request and resolve its attention")
			.addHelpText("after", HELP.ack),
	)
		.requiredOption(
			"--actor <identity>",
			"Acknowledging actor; overrides BD_ACTOR",
			process.env["BD_ACTOR"],
		)
		.requiredOption("--reason <text>", "Why this failure no longer needs attention")
		.action(async (id: string, options: AckOptions) => {
			writeResult(await deps.ack(id, options), { json: argv.includes("--json") }, deps.stdout);
		});
	inspectionOptions(
		program
			.command("stop <spawn-id>")
			.description("Close a request; Colony reacts when awake")
			.addHelpText("after", HELP.stop),
	)
		.requiredOption("--actor <identity>", "Identity closing this request", process.env["BD_ACTOR"])
		.action(async (id: string, options: StopOptions) => {
			writeResult(await deps.stop(id, options), { json: argv.includes("--json") }, deps.stdout);
		});
	try {
		await program.parseAsync(argv, { from: "user" });
		return SUCCESS;
	} catch (error) {
		return reportFailure(error, argv.includes("--json") || argv.includes("--schema"), {
			...deps,
			command: "bee",
		});
	}
}

// --- Private functions ---
function submissionOptions(command: Command): Command {
	return command
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
		.requiredOption("--actor <identity>", "Requester identity", process.env["BD_ACTOR"])
		.option("--model <model>", "Captured model override")
		.option("--effort <effort>", "Captured effort override")
		.option("--harness <name>", "Captured runtime formula name")
		.option("--cwd <directory>", "Execution directory, resolved from submission cwd")
		.option("--prompt <text>", "Replace optional execution direction; normally use the task bead")
		.option("--system-prompt <text>", "Replace the kind role/protocol; normally keep its default");
}
function inspectionOptions(command: Command): Command {
	return command
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"]);
}
// eslint-disable-next-line max-statements -- Render the three distinct public request results at one output boundary.
function writeResult(
	result: BeeResult,
	{ json, includePrompt = false }: { json: boolean; includePrompt?: boolean },
	stdout: (text: string) => void,
): void {
	if (json) {
		stdout(`${JSON.stringify({ ok: true, ...jsonResult(result, includePrompt) })}\n`);
		return;
	}
	if (result.kind === "bee_kinds") {
		const lines = result.kinds.map((kind) => {
			const summary = `${kind.name}: ${kind.description} (workflow: ${kind.workflow})`;
			if ("configuration" in kind) {
				return `${summary}\n${JSON.stringify(kind.configuration, undefined, JSON_INDENT)}`;
			}
			return summary;
		});
		if (lines.length === SUCCESS) {
			stdout("No visible bee kinds.\n");
		} else {
			stdout(`${lines.join("\n")}\n`);
		}
		return;
	}
	if (result.kind === "assessment_submitted") {
		stdout(`Submitted assessment ${result.assessmentId}; Colony validates when awake.\n`);
		return;
	}
	if (result.kind === "drone_verdict_submitted") {
		stdout(
			`Submitted verdict for ${result.requestId}, attempt ` +
				`${result.attemptId}, review ${result.reviewId}; Colony validates when ` +
				`awake.\n`,
		);
		return;
	}
	if (result.kind === "finish_submitted") {
		stdout(
			`Submitted finish for ${result.requestId}, attempt ` +
				`${result.attemptId}; Colony validates and settles when awake.\n`,
		);
		return;
	}
	if (result.kind === "spawn_created") {
		stdout(`Created bee request ${result.request.id} for ${result.request.assignee}.\n`);
		return;
	}
	if (result.kind === "workflow_spawn_created") {
		stdout(
			"Created workflow " +
				`${result.workflow.runId}` +
				" and driver request " +
				`${result.request.id}` +
				" for " +
				`${result.request.identity}` +
				".\n",
		);
		return;
	}
	if (result.kind === "request_list") {
		if (result.requests.length === SUCCESS) {
			stdout("No matching bee requests.\n");
		} else {
			stdout(`${result.requests.map((request) => formatRequest(request)).join("\n\n")}\n`);
		}
		return;
	}
	if (result.kind === "request_acknowledged") {
		const { request } = result;
		const lines = [
			`Request ${request.id}: ${request.disposition.outcome}; resolution: ` +
				`${request.resolution.kind}; labels: ${request.labelPublication}`,
		];
		if (request.acknowledgment !== null) {
			lines.push(formatAcknowledgment(request.acknowledgment));
		}
		if (request.resolution.kind === "superseded") {
			lines.push(`Replacement: ${request.resolution.replacementIds.join(", ")}`);
		}
		stdout(`${lines.join("\n")}\n`);
		return;
	}
	stdout(`${formatRequest(result.request, includePrompt)}\n`);
}

/** Project command-sized JSON without changing native facts or internal inspection results. */
function jsonResult(result: BeeResult, includePrompt: boolean) {
	switch (result.kind) {
		case "spawn_created": {
			const { id, assignee } = result.request;
			return { kind: result.kind, request: { assignee, id } };
		}
		case "request_stopped": {
			const { request } = result;
			return {
				...result,
				request: {
					acknowledgment: request.acknowledgment,
					host: request.host,
					closeReason: request.closeReason,
					closedAt: request.closedAt,
					disposition: request.disposition,
					id: request.id,
					identity: request.identity,
					labelPublication: request.labelPublication,
					needsAttention: request.needsAttention,
					resolution: request.resolution,
					status: request.status,
					supersedes: request.supersedes,
				},
			};
		}
		case "request_list": {
			return { ...result, requests: result.requests.map(withoutPrompt) };
		}
		case "request_status": {
			if (includePrompt) {
				return result;
			}
			return { ...result, request: withoutPrompt(result.request) };
		}
		default: {
			return result;
		}
	}
}

function withoutPrompt(request: RequestView) {
	const { cwd, effort, harness, kind, model } = request.recipe;
	return { ...request, recipe: { cwd, effort, harness, kind, model } };
}

/* eslint-disable-next-line max-statements --
 * Keep the human request facts and explicitly stale observations in one formatter.
 */
function formatRequest(request: RequestView, includePrompt = false): string {
	const lines = [
		`Request ${request.id}: ${request.status}`,
		`Identity: ${request.identity}`,
		`Host: ${request.host ?? "unbound"}`,
		`Outcome: ${request.disposition.outcome}; resolution: ` +
			`${request.disposition.resolution}; labels: ` +
			`${request.labelPublication}`,
		`Recipe: ${request.recipe.kind} / ${request.recipe.harness} / ` +
			`${request.recipe.model} / ${request.recipe.effort}`,
	];
	if (request.closedAt !== null) {
		lines.push(`Closed: ${request.closedAt}`);
	}
	if (request.closeReason !== null) {
		lines.push(`Closure reason: ${request.closeReason}`);
	}
	lines.push(`Resolution: ${request.resolution.kind}; needs attention: ${request.needsAttention}`);
	if (request.resolution.kind === "superseded") {
		lines.push(`Replacement: ${request.resolution.replacementIds.join(", ")}`);
	}
	if (request.acknowledgment !== null) {
		lines.push(formatAcknowledgment(request.acknowledgment));
	}
	if (request.supersedes.length > SUCCESS) {
		lines.push(`Supersedes: ${request.supersedes.join(", ")}`);
	}
	for (const task of request.tasks) {
		lines.push(
			`Task ${task.id}: ${task.status}; ${task.readiness}; assignee ${task.assignee ?? "unassigned"}`,
		);
	}
	if (request.lastObservation === null) {
		lines.push("Last recorded observation: none (execution state unknown)");
	} else {
		lines.push(
			`Last recorded observation (${request.lastObservation.createdAt}, ` +
				`${request.lastObservation.author}): ${request.lastObservation.text}`,
		);
	}
	if (request.stdoutActivity === null) {
		lines.push("Latest stdout activity: unknown (no attempt observation)");
	} else {
		const activity = request.stdoutActivity;
		lines.push(
			`Latest stdout activity (attempt ${activity.attemptNumber}, ` +
				`${activity.attemptId}): ` +
				`${activity.lastOutputAt ?? "unknown (no output observed)"}`,
		);
	}
	if (includePrompt) {
		lines.push(
			`Captured system prompt:\n${request.recipe.system_prompt}`,
			`Captured prompt:\n${request.recipe.prompt}`,
		);
	}
	lines.push(
		"Stdout silence does not establish idle, stalled or dead execution.",
		"Observations may be stale; daemon availability is not queried.",
	);
	return lines.join("\n");
}

function formatAcknowledgment(acknowledgment: NonNullable<RequestView["acknowledgment"]>): string {
	return (
		"Acknowledged by " +
		`${acknowledgment.actor}` +
		" at " +
		`${acknowledgment.acknowledgedAt}` +
		": " +
		`${acknowledgment.reason}`
	);
}
