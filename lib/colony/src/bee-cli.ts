import type { RequestListResult, RequestResult, RequestView } from "./requests.ts";
import { Command } from "commander";
import type { SpawnResult } from "./producer.ts";
import { reportFailure } from "./cli.ts";

const SUCCESS = 0;
export interface SpawnOptions {
	/** Repository discovery directory. */
	repo: string;
	/** Selected Beads endpoint. */
	beadsDb: string;
	/** Requester credited with creation. */
	actor: string;
	/** Explicit friendly assignee, or mint one when absent. */
	identity?: string;
	/** Override the kind's model. */
	model?: string;
	/** Override the kind's reasoning effort. */
	effort?: string;
	/** Name of the runtime formula, which may be installed later. */
	harness?: string;
	/** Execution directory; does not affect discovery or tracker. */
	cwd?: string;
	/** Override the kind's work instructions. */
	prompt?: string;
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
export interface BeeDependencies {
	/** Read native request, task and last observation facts. */
	status: (id: string, options: InspectionOptions) => Promise<RequestResult>;
	/** Inspect requests in the explicitly selected tracker. */
	list: (options: ListOptions) => Promise<RequestListResult>;
	/** Close a validated request without daemon or process access. */
	stop: (id: string, options: StopOptions) => Promise<RequestResult>;
	/** Submit an offline request. */
	spawn: (kind: string, tasks: string[], options: SpawnOptions) => Promise<SpawnResult>;
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
		.description("Submit captured bee requests without a daemon")
		.option("--json", "Emit errors as JSON too")
		.configureOutput({ writeErr: () => {}, writeOut: deps.stdout })
		.exitOverride();
	submissionOptions(
		program
			.command("spawn <kind> <tasks...>")
			.description("Snapshot a kind recipe and relate task beads without claiming them"),
	).action(async (kind: string, tasks: string[], options: SpawnOptions) => {
		writeResult(await deps.spawn(kind, tasks, options), argv.includes("--json"), deps.stdout);
	});
	submissionOptions(
		program
			.command("retry <spawn-id>")
			.description("Replace an unsuccessful request using current defaults and unfinished tasks"),
	)
		.option("--kind <kind>", "Select another kind; defaults to the old request kind")
		.action(async (id: string, options: RetryOptions) => {
			writeResult(await deps.retry(id, options), argv.includes("--json"), deps.stdout);
		});
	inspectionOptions(
		program
			.command("status <spawn-id>")
			.description("Inspect request facts and timestamped last observations"),
	).action(async (id: string, options: InspectionOptions) => {
		writeResult(await deps.status(id, options), argv.includes("--json"), deps.stdout);
	});
	inspectionOptions(
		program
			.command("list")
			.description("List open requests and unresolved failures; observations may be stale"),
	)
		.option("--all", "Include resolved historical requests", false)
		.action(async (options: ListOptions) => {
			writeResult(await deps.list(options), argv.includes("--json"), deps.stdout);
		});
	inspectionOptions(
		program.command("stop <spawn-id>").description("Close a request; Colony reacts when awake"),
	)
		.requiredOption("--actor <identity>", "Identity closing this request", process.env["BD_ACTOR"])
		.action(async (id: string, options: StopOptions) => {
			writeResult(await deps.stop(id, options), argv.includes("--json"), deps.stdout);
		});
	try {
		await program.parseAsync(argv, { from: "user" });
		return SUCCESS;
	} catch (error) {
		return reportFailure(error, argv.includes("--json"), { ...deps, command: "bee" });
	}
}

// --- Private functions ---
function submissionOptions(command: Command): Command {
	return command
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
		.requiredOption("--actor <identity>", "Requester identity", process.env["BD_ACTOR"])
		.option("--identity <name>", "Supplied friendly bee identity")
		.option("--model <model>", "Captured model override")
		.option("--effort <effort>", "Captured effort override")
		.option("--harness <name>", "Captured runtime formula name")
		.option("--cwd <directory>", "Execution directory, resolved from submission cwd")
		.option("--prompt <text>", "Captured work instructions");
}
function inspectionOptions(command: Command): Command {
	return command
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"]);
}
// eslint-disable-next-line max-statements -- Render the three distinct public request results at one output boundary.
function writeResult(
	result: RequestResult | RequestListResult | SpawnResult,
	json: boolean,
	stdout: (text: string) => void,
): void {
	if (json) {
		stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
		return;
	}
	if (result.kind === "spawn_created") {
		stdout(`Created bee request ${result.request.id} for ${result.request.assignee}.\n`);
		return;
	}
	if (result.kind === "request_list") {
		if (result.requests.length === SUCCESS) {
			stdout("No matching bee requests.\n");
		} else {
			stdout(`${result.requests.map(formatRequest).join("\n\n")}\n`);
		}
		return;
	}
	stdout(`${formatRequest(result.request)}\n`);
}
// eslint-disable-next-line max-statements -- Keep the human request facts and explicitly stale observations in one formatter.
function formatRequest(request: RequestView): string {
	const lines = [
		`Request ${request.id}: ${request.status}`,
		`Identity: ${request.identity}`,
		`Recipe: ${request.recipe.kind} / ${request.recipe.harness} / ${request.recipe.model} / ${request.recipe.effort}`,
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
			`Last recorded observation (${request.lastObservation.createdAt}, ${request.lastObservation.author}): ${request.lastObservation.text}`,
		);
	}
	lines.push("Observations may be stale; daemon availability is not queried.");
	return lines.join("\n");
}
