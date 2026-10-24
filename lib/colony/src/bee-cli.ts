/* eslint-disable import/max-dependencies --
 * CLI composes request, workflow submission, response and inspection contracts.
 */
import type { AcknowledgmentResult, RequestResult, RequestView } from "./requests.ts";
import type { BeeSetupOptions, BeeSetupResult } from "./setup.ts";
import type { KindOptions, KindsResult } from "./kinds.ts";
import type {
	PublishOptions,
	ResponseCommandResult,
	ResponseGetOptions,
	ResponsePageOptions,
} from "./responses.ts";
import type {
	StageOptions,
	WorkflowSpawnOptions,
	WorkflowSubmissionResult,
} from "./workflow-submission.ts";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { formatResponseResult, responseJsonSchema } from "./responses.ts";
import { BeeSetupError } from "./setup.ts";
import { Command } from "commander";
import type { FinishResult } from "./launch.ts";
import { HELP } from "./bee-help.ts";
import type { RunOptions } from "./run.ts";
import type { SkillProvider } from "skills-handler";
import type { SpawnResult } from "./producer.ts";
import changelog from "../bee-changelog.json";
import { kindsJsonSchema } from "./kinds.ts";
import { registerSkills } from "./skills.ts";
import { reportFailure } from "./cli.ts";
import { version } from "../package.json";

const SUCCESS = 0;
const FAILURE = 1;
const JSON_INDENT = 2;
type BeeResult =
	| BeeSetupResult
	| AcknowledgmentResult
	| RequestResult
	| SpawnResult
	| WorkflowSubmissionResult
	| FinishResult
	| KindsResult
	| ResponseCommandResult;

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
	/** Permit deliberate replacement of a cancelled request with no existing replacement. */
	resumeCancelled?: boolean;
}
export interface InspectionOptions {
	/** Canonical repository discovery directory. */
	repo: string;
	/** Explicit tracker database; inspection does not need daemon state. */
	beadsDb: string;
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
	/** Construct Bee's offline skills provider on demand. */
	loadSkills: () => Promise<SkillProvider>;
	/** Refresh Bee's attention query in the selected database. */
	setup: (options: BeeSetupOptions) => Promise<BeeSetupResult>;
	/** File one authored response against its task and optional exact request. */
	responsePublish: (task: string, options: PublishOptions) => Promise<ResponseCommandResult>;
	/** Expand an exact record or resolve a task/request lineage. */
	responseGet: (
		id: string | undefined,
		options: ResponseGetOptions,
	) => Promise<ResponseCommandResult>;
	/** Bounded source-specific discovery. */
	responseSearch: (query: string, options: ResponsePageOptions) => Promise<ResponseCommandResult>;
	/** Explicit task-local legacy provenance. */
	responseHistory: (task: string, options: ResponsePageOptions) => Promise<ResponseCommandResult>;
	/** Read the exact captured request response without readiness or discussion hydration. */
	result: (id: string, options: InspectionOptions) => Promise<ResponseCommandResult>;
	/** Hand the current terminal to a user-invoked interactive harness. */
	run: (kind: string, options: RunOptions) => Promise<void>;
	/** Accept a failed request without changing its outcome or linked tasks. */
	ack: (id: string, options: AckOptions) => Promise<AcknowledgmentResult>;
	/** Discover configured kinds independently of the tracker and daemon. */
	kinds: (name: string | undefined, options: KindOptions) => Promise<KindsResult>;
	/** Submit an attempt-scoped self-report using injected provenance. */
	finish: (outcome: string, options: { reason?: string }) => Promise<FinishResult>;
	/** Read native request, task and last observation facts. */
	status: (id: string, options: InspectionOptions) => Promise<RequestResult>;
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
	responseCommands(program, argv, deps);
	const system = program
		.command("system")
		.description("Workflow dispatch protocol for Busy Bee")
		.addHelpText("after", HELP.system);

	program
		.command("changelog")
		.description(
			"Read embedded history offline; defaults to the latest recorded release at or below this executable version",
		)
		.summary("Read offline release history")
		.option("--since <version>", "Releases newer than this stable version (exclusive)")
		.option("--release <version>", "Read one exact recorded release; cannot combine with --since")
		.option("--limit <count>", "Changes per page (1–100, default 20)")
		.option("--offset <count>", "Skip matching changes (default 0)")
		.option("--schema", "Print the successful JSON response schema")
		.option("--json", "Emit one JSON document with silent stderr")
		.action(function changelogCommand(this: Command) {
			const options = this.optsWithGlobals();
			if (options["schema"] === true) {
				deps.stdout(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "bee", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.stdout(output);
		});
	registerSkills(program, "bee", deps);
	inspectionOptions(
		program.command("setup").description("Install Bee's attention preset in the selected database"),
	)
		.requiredOption(
			"--actor <identity>",
			"Setup actor; overrides BD_ACTOR",
			process.env["BD_ACTOR"],
		)
		.addHelpText(
			"after",
			`
Installs bee-attention for failed, unresolved spawn requests, including closed ones.
Saved queries are local to the selected database; run setup for each tracker clone.
Replaces only this saved preset.

Uses --beads-db or BEADS_DB without requiring a permanent tracker checkout.
No daemon, bee-kind configuration or BV executable is needed. No issue labels change.
Beeswax manages Hive's BV views separately; see beeswax setup --help.
This command neither reads nor writes BV recipes.

With --json, success returns kind: bee_setup, repository and preset.
Setup failures retain repository, presetRemoved and presetInstalled. Inspect those
confirmed effects before retrying after interruption.
Read br query --help to run saved queries.
`,
		)
		.action(async (options: BeeSetupOptions) => {
			writeResult(await deps.setup(options), { json: argv.includes("--json") }, deps.stdout);
		});
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
		system
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
		.option("--resume-cancelled", "Also permit deliberate resumption of a cancelled request")
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
		if (error instanceof BeeSetupError) {
			if (argv.includes("--json")) {
				const failure = {
					ok: false,
					kind: "error",
					reason: "bee_setup_failed",
					message: error.message,
					...error.context,
				};
				deps.stdout(`${JSON.stringify(failure)}\n`);
			} else {
				deps.stderr(`bee: ${error.message}\n${JSON.stringify(error.context)}\n`);
			}
			return FAILURE;
		}
		return reportFailure(error, argv.includes("--json") || argv.includes("--schema"), {
			...deps,
			command: "bee",
		});
	}
}

// --- Private functions ---
function responseCommands(program: Command, argv: string[], deps: BeeDependencies): void {
	const response = program
		.command("response")
		.description("Publish authored results or explicitly inspect historical sources")
		.option("--schema", "Print response command JSON output schemas without tracker access")
		.addHelpText("after", HELP.response)
		.action((options: { schema?: boolean }) => {
			if (options.schema) {
				deps.stdout(
					`${JSON.stringify({ ok: true, kind: "response_schema", schema: responseJsonSchema() })}\n`,
				);
			} else {
				response.help();
			}
		});
	const write = (result: ResponseCommandResult) =>
		writeResult(result, { json: argv.includes("--json") }, deps.stdout);
	inspectionOptions(
		response
			.command("publish <task>")
			.description("File complete Markdown as an immutable response")
			.addHelpText("after", HELP.responsePublish),
	)
		.requiredOption("--body-file <file>", "Complete authored Markdown, preserved verbatim")
		.requiredOption(
			"--actor <identity>",
			"Response author; overrides BD_ACTOR",
			process.env["BD_ACTOR"],
		)
		.option("--request <id>", "Exact request association; defaults to HIVE_SPAWN_ID")
		.option("--standalone", "Task-scoped artifact without a managed request", false)
		.option("--title <text>", "Short artifact summary")
		.option(
			"--supersedes <id>",
			"Explicit correction target; repeat for every current head",
			(id: string, ids: string[]) => [...ids, id],
			[],
		)
		.action(async (task: string, options: PublishOptions) =>
			write(await deps.responsePublish(task, options)),
		);
	inspectionOptions(
		response
			.command("get [response]")
			.description("Read a full exact response or resolve --task")
			.addHelpText("after", HELP.responseGet),
	)
		.option("--task <id>", "Resolve this producing task instead of an exact response ID")
		.option("--request <id>", "Resolve only this exact request lineage (requires --task)")
		.action(async (id: string | undefined, options: ResponseGetOptions) =>
			write(await deps.responseGet(id, options)),
		);
	responsePageOptions(
		response
			.command("search <query>")
			.description("Bounded response-record or historical-source candidates")
			.addHelpText("after", HELP.responseSearch),
	)
		.option(
			"--source <source>",
			"responses, comments or notes; each uses its own offset",
			"responses",
		)
		.action(async (query: string, options: ResponsePageOptions) =>
			write(await deps.responseSearch(query, options)),
		);
	responsePageOptions(
		response
			.command("history <task>")
			.description("Explicit original comments or notes; never inferred final results")
			.addHelpText("after", HELP.responseHistory),
	)
		.option(
			"--source <source>",
			"comments (fetches all task comments) or notes (one snapshot)",
			"comments",
		)
		.action(async (task: string, options: ResponsePageOptions) =>
			write(await deps.responseHistory(task, options)),
		);
	inspectionOptions(
		program
			.command("result <request>")
			.description("Read this exact request's authored response and native outcome"),
	)
		.addHelpText("after", HELP.result)
		.action(async (id: string, options: InspectionOptions) =>
			write(await deps.result(id, options)),
		);
}
function responsePageOptions(command: Command): Command {
	return inspectionOptions(command)
		.option(
			"--limit <count>",
			"Returned entries (1–100); notes remains one complete snapshot",
			"20",
		)
		.option("--offset <count>", "Nonnegative source-specific offset; notes requires 0", "0");
}

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
	if (
		result.kind === "response_published" ||
		result.kind === "response_get" ||
		result.kind === "response_search" ||
		result.kind === "response_history" ||
		result.kind === "request_result"
	) {
		stdout(formatResponseResult(result));
		return;
	}
	if (result.kind === "bee_setup") {
		stdout(`Installed ${result.preset} in ${result.repository.beadsDb}.\n`);
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
	let text = formatRequest(result.request, includePrompt);
	if (result.kind === "request_status") {
		text += `\nResponse: ${result.response.state}; IDs: ${result.response.responseIds.join(", ") || "none"}`;
	}
	stdout(`${text}\n`);
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
