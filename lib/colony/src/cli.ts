/* eslint-disable import/max-dependencies --
 * Compose daemon control, request inspection and configuration boundaries.
 */
import { Command, CommanderError } from "commander";
import { DaemonRequestError, DaemonUnavailableError } from "./client.ts";
import type { ExecutionClearance, ExecutionClearanceSelection } from "@hive/shared";
import {
	beesConfigSchema,
	executionClearanceSchema,
	executionClearanceSelectionSchema,
	policyChangeSchema,
} from "@hive/shared";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { CommandError } from "@hive/beads";
import { DaemonLifecycleError } from "./daemon-lifecycle.ts";
import type { DaemonResponse } from "./client.ts";
import type { Explanation } from "./explain.ts";
import type { HistoryResult } from "./history.ts";
import type { InitOptions } from "./initial-config.ts";
import type { InitializedResult } from "./producer.ts";
import type { LaunchedResult } from "./output.ts";
import { RequestPublicationError } from "./requests.ts";
import { ResponseError } from "./response-store.ts";
import type { RestartedDaemon } from "./daemon-lifecycle.ts";
import type { SkillProvider } from "skills-handler";
import { WorkflowCommandError } from "./workflows.ts";
import { WorkflowSubmissionError } from "./workflow-submission.ts";
import changelog from "../changelog.json";
import { initOptionsSchema } from "./initial-config.ts";
import { registerSkills } from "./skills.ts";
import { version } from "../package.json";
import { writeColonyResult } from "./output.ts";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const USAGE_ERROR = 2;

interface CliFailure {
	/** Human diagnostic retained from the failing boundary. */
	message: string;
	/** Machine-readable command or operational failure. */
	reason: string | number;
	/** Request whose native facts need label publication, when applicable. */
	requestId?: string;
	/** Replacements already created before a publication failure. */
	replacementIds?: string[];
}

export interface LaunchOptions {
	/** Directory used only to discover the canonical repository. */
	repo: string;
	/** Explicit tracker endpoint. */
	beadsDb: string;
	/** Directory for owned execution receipts and logs. */
	state: string;
}
export interface ServerOptions {
	/** Explicit state directory; omission selects the user default. */
	state?: string;
	/** Explicit socket; omitted selects the socket in state. */
	socket?: string;
}
export interface WakeOptions extends ServerOptions {
	/** Repository discovery directory. */
	repo: string;
	/** Selected tracker endpoint. */
	beadsDb: string;
	/** Activate only for the selected daemon lifetime. */
	temp: boolean;
}
export type RepositoryOptions = Omit<WakeOptions, "temp">;
export type ConfigOptions = RepositoryOptions &
	(
		| { operation: "show" | "history" }
		| { operation: "reset"; actor: string }
		| { operation: "update"; actor: string; file: string }
	);
export interface ColonyDependencies {
	/** Construct Colony's offline skills provider on demand. */
	loadSkills: () => Promise<SkillProvider>;
	/** Fresh scoped execution proof serialized with the owning daemon's admissions. */
	executionClearance: (
		scope: ExecutionClearanceSelection,
		options: RepositoryOptions,
	) => Promise<ExecutionClearance>;
	/** Explain one request using read-only tracker and runtime evidence. */
	explain: (id: string, options: RepositoryOptions) => Promise<Explanation>;
	/** Read bounded operation evidence without contacting the daemon or tracker. */
	events: (
		options: RepositoryOptions & { request?: string; failures: boolean },
	) => Promise<HistoryResult>;
	/** Inspect retained request and attempt records for one repository. */
	inspect: (options: RepositoryOptions) => Promise<DaemonResponse>;
	/** Inspect or change formula/limit policy on the selected running daemon. */
	config: (options: ConfigOptions) => Promise<DaemonResponse>;
	/** Add durable membership without starting its loop. */
	add: (options: RepositoryOptions) => Promise<DaemonResponse>;
	/** Drain scheduling while detached executions continue. */
	sleep: (options: RepositoryOptions) => Promise<DaemonResponse>;
	/** Remove membership and retain execution records. */
	remove: (options: RepositoryOptions) => Promise<DaemonResponse>;
	/** Register and wake a repository, lazily starting the daemon. */
	wake: (options: WakeOptions) => Promise<DaemonResponse>;
	/** Run the foreground daemon for a service manager. */
	serve: (options: ServerOptions & { json: boolean }) => Promise<void>;
	/** Query the selected running daemon. */
	status: (options: ServerOptions) => Promise<DaemonResponse>;
	/** Stop the selected running daemon. */
	stop: (options: ServerOptions) => Promise<DaemonResponse>;
	/** Restart or resume the selected daemon and verify native ownership and recovery. */
	restart: (
		options: ServerOptions & {
			/** Select one additional replacement within an unfinished restart. */
			replaceRetained: boolean;
		},
	) => Promise<RestartedDaemon>;
	/** Write canonical configuration without overwriting it. */
	init: (options: InitOptions) => Promise<InitializedResult>;
	/** Execute the isolated Colony process. */
	launch: (id: string, options: LaunchOptions) => Promise<LaunchedResult>;
	/** Print result/help. */
	stdout: (text: string) => void;
	/** Print diagnostics. */
	stderr: (text: string) => void;
}
// eslint-disable-next-line max-statements -- Each command declares its own public CLI contract.
export async function runCli(argv: string[], deps: ColonyDependencies): Promise<number> {
	const program = new Command()
		.name("colony")
		.version(version)
		.description("Launch captured bee requests")
		.option("--json", "Emit errors as JSON too")
		.configureOutput({ writeErr: () => {}, writeOut: deps.stdout })
		.exitOverride();
	const system = program.command("system").description("Typed daemon observation interfaces");
	system
		.command("execution-clearance-schema")
		.description("Read clearance selection and success schemas without contacting a daemon")
		.addHelpText(
			"after",
			"\nEmits one JSON document with selection and schema. Requires no repository, " +
				"tracker, configuration or daemon. The success schema includes both clear and " +
				"refused observations; use system execution-clearance --help for prerequisites.",
		)
		.action(() => {
			const successSchema = executionClearanceSchema.extend({ ok: z.literal(true) });
			const document = {
				ok: true,
				kind: "execution_clearance_schema",
				selection: z.toJSONSchema(executionClearanceSelectionSchema),
				schema: z.toJSONSchema(successSchema),
			};
			deps.stdout(`${JSON.stringify(document)}\n`);
		});
	repositoryOptions(
		system
			.command("execution-clearance <run>")
			.description("Observe owning-host quiescence for the exact workflow inventory")
			.requiredOption(
				"--anchors <json>",
				"JSON array of the run and every generated visit/group ID",
			)
			.addHelpText(
				"after",
				"\nBusy Bee calls this while holding the run's checkpoint lock. Supply its exact " +
					"generated inventory, including completed anchors. The selected owning-host " +
					"daemon must be running and have this repository/tracker registered; this read " +
					"does not start it, stop workers or change requests.\n\n" +
					"The daemon serializes clearance with final admission and verifies every retained " +
					"attempt's ownership and exit. Closed requests alone do not prove exit. Missing " +
					"history, foreign/unbound hosts, live or unverified processes and marked manual " +
					"launches refuse clearance. This is a scoped local observation, not a durable " +
					"lease or distributed lock.\n\n" +
					"Use --json for scope, host, observedAt and result. A successful read can return " +
					"result.kind refused with blockers; ok true does not mean execution is clear. " +
					"Offline schemas: colony system execution-clearance-schema --json.",
			),
	).action(async (runId: string, options: RepositoryOptions & { anchors: string }) => {
		const scope = executionClearanceSelectionSchema.parse({
			runId,
			anchorIds: JSON.parse(options.anchors),
		});
		writeColonyResult(
			await deps.executionClearance(scope, options),
			argv.includes("--json"),
			deps.stdout,
		);
	});

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
				{ tool: "colony", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.stdout(output);
		});
	registerSkills(program, "colony", deps);
	program
		.command("events")
		.description("Read retained operation evidence without waking or reconciling")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
		.option("--state <directory>", "Daemon state directory")
		.option("--request <spawn-id>", "Only operations for this request")
		.option("--failures", "Only recorded failures (including handled conflicts)", false)
		.action(async (options: RepositoryOptions & { request?: string; failures: boolean }) => {
			writeColonyResult(await deps.events(options), argv.includes("--json"), deps.stdout);
		});
	program
		.command("init")
		.description("Create canonical .hive/bees.toml without overwriting it")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--owner <identity>", "Human request owner")
		.option("--harness <codex|claude|both>", "Worker harness selection", "codex")
		.requiredOption("--model <model>", "Default worker model (Codex in both mode)")
		.option("--claude-model <model>", "Additional Claude worker model (required only in both mode)")
		.option(
			"--permission-mode <restricted|unrestricted>",
			"Native worker permission mode",
			"restricted",
		)
		.addHelpText(
			"after",
			`
Creates worker for the selected harness. In both mode, worker uses Codex and
claude-worker uses Claude; --model selects Codex and --claude-model selects Claude.
For a single harness, use --model alone.

Restricted is the default: managed Codex uses workspace-write and managed Claude
uses its default permission mode. Unrestricted selects the harness's native
permission bypass. Review the generated formula and verify private attempt-artifact
access before relying on completion reporting. Permission mode does not grant hook trust.

Configuration fields and defaults: colony config schema
Custom kinds, hook trust and first execution: colony skills file operations references/configuration.md
`,
		)
		.action(async (options: unknown) => {
			writeColonyResult(
				await deps.init(initOptionsSchema.parse(options)),
				argv.includes("--json"),
				deps.stdout,
			);
		});
	program
		.command("launch <spawn-id>")
		.description("Run one eligible request and record its actual invocation")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
		.requiredOption("--state <directory>", "Receipt and log directory")
		.action(async (id: string, options: LaunchOptions) => {
			writeColonyResult(await deps.launch(id, options), argv.includes("--json"), deps.stdout);
		});
	serverOptions(
		program
			.command("wake")
			.description(
				"Reload policy and wake a repository; see daemon restart --help for startup prerequisites",
			),
	)
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
		.option("--temp", "Activate for this daemon lifetime only", false)
		.action(async (options: WakeOptions) => {
			writeColonyResult(await deps.wake(options), argv.includes("--json"), deps.stdout);
		});
	for (const operation of ["add", "sleep", "remove"] as const) {
		serverOptions(program.command(operation).description(registryDescription(operation)))
			.option("--repo <directory>", "Repository discovery directory", ".")
			.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"])
			.action(async (options: RepositoryOptions) => {
				writeColonyResult(await deps[operation](options), argv.includes("--json"), deps.stdout);
			});
	}
	serverOptions(
		program.command("list").description("List colonies and effective scheduling policy"),
	).action(async (options: ServerOptions) => {
		writeColonyResult(await deps.status(options), argv.includes("--json"), deps.stdout);
	});
	repositoryOptions(
		program
			.command("inspect")
			.description("Inspect retained requests, attempts and policy history"),
	).action(async (options: RepositoryOptions) => {
		writeColonyResult(await deps.inspect(options), argv.includes("--json"), deps.stdout);
	});
	repositoryOptions(
		program
			.command("explain <spawn-id>")
			.description("Explain request progress without lifecycle effects")
			.addHelpText(
				"after",
				`
Read native facts, all retained attempts for this request, local-host capacity
reservations and fresh process ownership. Use --json for evidence and diagnostics.
Read times do not establish checkpoint age. Unavailable sources remain explicit.
This read neither starts the daemon nor reconciles requests or reserves capacity.
`,
			),
	).action(async (id: string, options: RepositoryOptions) => {
		writeColonyResult(await deps.explain(id, options), argv.includes("--json"), deps.stdout);
	});

	const config = program
		.command("config")
		.description("Discover configuration schemas or inspect and change runtime policy");
	config
		.command("schema")
		.description(
			"Print canonical configuration and runtime update JSON schemas with defaults, offline",
		)
		.action(() => {
			deps.stdout(
				`${JSON.stringify({
					ok: true,
					kind: "configuration_schema",
					configuration: z.toJSONSchema(beesConfigSchema, { io: "input" }),
					runtimeUpdates: z.toJSONSchema(policyChangeSchema, { io: "input" }),
				})}\n`,
			);
		});
	for (const operation of ["show", "history"] as const) {
		repositoryOptions(config.command(operation).description(configDescription(operation))).action(
			async (options: RepositoryOptions) => {
				writeColonyResult(
					await deps.config({ ...options, operation }),
					argv.includes("--json"),
					deps.stdout,
				);
			},
		);
	}
	repositoryOptions(
		config.command("reset").description("Reload canonical policy and retain revision history"),
	)
		.requiredOption(
			"--actor <identity>",
			"Identity applying this policy change",
			process.env["BD_ACTOR"],
		)
		.action(async (options: RepositoryOptions & { actor: string }) => {
			writeColonyResult(
				await deps.config({ ...options, operation: "reset" }),
				argv.includes("--json"),
				deps.stdout,
			);
		});
	repositoryOptions(
		config.command("update").description("Apply one named formula or complete limits update"),
	)
		.requiredOption("--file <path>", "Strict JSON formula or limits change")
		.addHelpText(
			"after",
			`
Pass one strict JSON object in --file; comments and unknown fields are rejected.

Replace one named formula (executable and argv required; headless optional):
  {
    "kind": "formula", "name": "example",
    "formula": {
      "executable": "/path/to/harness",
      "argv": ["{{#if system_prompt}}--system-prompt{{/if}}", "{{system_prompt}}", "{{prompt}}"]
    }
  }
Use the installed harness's executable and supported arguments.

Replace all limits (colony, kind, kinds and worktree are all required):
  { "kind": "limits", "limits": { "colony": 4, "kind": 2, "kinds": { "reviewer": 1 }, "worktree": 2 } }
Limits are nonnegative integers; kinds maps names to per-kind overrides.
Choose values deliberately; omitted prior overrides are removed.

Formula templates: colony skills file operations references/configuration.md
Policy diagnosis and activation: colony skills file operations references/recovery.md
`,
		)
		.requiredOption(
			"--actor <identity>",
			"Identity applying this policy change",
			process.env["BD_ACTOR"],
		)
		.action(async (options: RepositoryOptions & { actor: string; file: string }) => {
			writeColonyResult(
				await deps.config({ ...options, operation: "update" }),
				argv.includes("--json"),
				deps.stdout,
			);
		});
	const daemon = program.command("daemon").description("Control the selected local daemon");
	serverOptions(daemon.command("serve").description("Run the daemon in the foreground")).action(
		async (options: ServerOptions) => {
			await deps.serve({ ...options, json: argv.includes("--json") });
			writeColonyResult(
				{ exitCode: SUCCESS, kind: "daemon_completed" },
				argv.includes("--json"),
				deps.stdout,
			);
		},
	);
	serverOptions(
		daemon
			.command("status")
			.description("Read daemon membership, policy and retained attempt observations"),
	).action(async (options: ServerOptions) => {
		writeColonyResult(await deps.status(options), argv.includes("--json"), deps.stdout);
	});
	serverOptions(daemon.command("stop").description("Stop the running daemon")).action(
		async (options: ServerOptions) => {
			writeColonyResult(await deps.stop(options), argv.includes("--json"), deps.stdout);
		},
	);
	serverOptions(
		daemon
			.command("restart")
			.description("Restart the daemon and verify independent ownership and recovery"),
	)
		.option(
			"--replace-retained",
			"Deliberately replace the recorded daemon once within an unfinished restart",
			false,
		)
		.action(async (options: ServerOptions & { replaceRetained: boolean }) => {
			writeColonyResult(await deps.restart(options), argv.includes("--json"), deps.stdout);
		})
		.addHelpText(
			"after",
			`
Use colony daemon restart --json for a verified replacement or to finish an
interrupted restart. Native startup requires the macOS GUI launchd domain or a
reachable Linux systemd user manager via systemctl --user. Platform, manager,
runtime access and PATH are checked before stopping a daemon. Service setup adds
no login startup or automatic restart policy.

A fresh restart drains the old daemon, proves its process exited, then verifies
a distinct ready daemon, independent native ownership and repository recovery.
Recovery is polled with a 10-minute deadline; connection or verification errors
can fail sooner.

Durable registrations, Beads database selections, awake/asleep intent and surviving
attempts are preserved. Temporary registrations and policy overrides end with the
old daemon. Detached bees continue running.

With an unfinished receipt and no saved continuation, the default retry checks its
recorded replacement in place against the original registration and attempt
manifest. Keep the same state/socket. An unavailable, mismatched or unowned
replacement fails before changing the receipt.

To deliberately replace that recorded daemon once, use --replace-retained. Admission
requires its exact endpoint, lifetime/PID, live process fingerprint and independent
native ownership. The same restart.json retains the original previous, daemon,
manifest and confirmedEffects; continuation records the additional leg separately.
It saves stop intent before requesting graceful stop. A lost stop response triggers
up to 10 minutes of inspection for the exact handoff and verified outgoing exit.
Only then can native startup proceed. Recovery must preserve both the original
and later handoff inventories, including intervening attempts; natural completion
is allowed. Failed recovery or duplicate live attempts prevent completion.

Retries of an unfinished continuation resume its saved phase, including when the
flag is repeated. stop_requested only inspects handoff/exit; start_requested only
observes a replacement. Neither call is resubmitted. A crash between saving intent
and making its call can leave a retained failure that retry alone cannot resolve;
diagnose the saved phase and effects. Once the new daemon is observed, retries
finish its recovery in place.

JSON success has kind restarted, previous (original id/pid or null when unobserved),
daemon, supervisor (kind launchd or systemd) and confirmedEffects. Explicit
continuation adds continuation with its phase, identities, handoff and own effects.
Failure kind error with reason daemon_lifecycle_incomplete includes target,
checkpoint, confirmedEffects, receipt path and diagnostics, plus continuationPhase
when present. Request failures include request and phase (transport, response,
decode or daemon); a lost stop response is retained in continuation.stopFailure.
Retain restart.json and daemon-handoff.json when present; inspect both sets of
effects and resolve the failure before retrying. Pending recovery is not success.
`,
		);
	try {
		await program.parseAsync(argv, { from: "user" });
		return SUCCESS;
	} catch (error) {
		return reportFailure(error, argv.includes("--json"), { ...deps, command: "colony" });
	}
}

// --- Private functions ---
/* eslint-disable-next-line max-statements --
 * Normalize failures and preserve partial publication context at the shared CLI
 * boundary.
 */
export function reportFailure(
	error: unknown,
	json: boolean,
	deps: Pick<ColonyDependencies, "stdout" | "stderr"> & { command: "bee" | "colony" },
): number {
	if (error instanceof CommanderError && error.exitCode === SUCCESS) {
		return SUCCESS;
	}
	let message = String(error);
	if (error instanceof Error) {
		({ message } = error);
	}
	const failure: CliFailure = { message, reason: failureReason(error) };
	if (error instanceof DaemonLifecycleError) {
		Object.assign(failure, {
			reason: error.reason,
			target: error.target,
			confirmedEffects: error.confirmedEffects,
			checkpoint: error.checkpoint,
			continuationPhase: error.checkpoint?.continuation?.phase,
			receipt: `${error.target.state}/restart.json`,
		});
	}
	let requestError = error;
	if (error instanceof DaemonLifecycleError) {
		requestError = error.cause;
	}
	if (requestError instanceof DaemonRequestError) {
		Object.assign(failure, { request: requestError.request, phase: requestError.phase });
	}
	if (error instanceof RequestPublicationError) {
		failure.requestId = error.requestId;
		failure.replacementIds = error.replacementIds;
	}
	if (error instanceof WorkflowCommandError || error instanceof WorkflowSubmissionError) {
		Object.assign(failure, error.context);
		failure.reason = error.reason;
	}
	if (error instanceof ResponseError) {
		if (!json && error.responseIds.length > SUCCESS) {
			failure.message += `\nResponse IDs: ${error.responseIds.join(", ")}`;
		}
		if (!json && error.uncertainOperation !== undefined) {
			failure.message += `\nInspect the ${error.uncertainOperation} effect before retrying.`;
		}
		Object.assign(failure, {
			reason: error.reason,
			taskId: error.taskId,
			requestId: error.requestId,
			responseIds: error.responseIds,
			confirmedEffects: error.confirmedEffects,
			uncertainOperation: error.uncertainOperation,
		});
	}
	writeFailure(failure, json, deps);
	if (error instanceof CommanderError) {
		return USAGE_ERROR;
	}
	return FAILURE;
}
function writeFailure(
	failure: CliFailure,
	json: boolean,
	deps: Pick<ColonyDependencies, "stdout" | "stderr"> & { command: "bee" | "colony" },
): void {
	if (json) {
		deps.stdout(`${JSON.stringify({ kind: "error", ...failure, ok: false })}\n`);
	} else {
		deps.stderr(`${deps.command}: ${failure.message}\n`);
	}
}

function serverOptions(command: Command): Command {
	return command
		.option(
			"--state <directory>",
			"Daemon state directory (default: $XDG_STATE_HOME/hive/colony or ~/.local/state/hive/colony)",
		)
		.option("--socket <path>", "Daemon socket; requires --state (default: <state>/colony.sock)");
}
function registryDescription(operation: "add" | "sleep" | "remove"): string {
	return {
		add: "Register durably, initially asleep; see daemon restart --help for startup prerequisites",
		remove: "Remove registration while retaining detached executions and records",
		sleep: "Drain and pause scheduling; detached executions continue",
	}[operation];
}

function repositoryOptions(command: Command): Command {
	return serverOptions(command)
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--beads-db <path>", "Selected Beads database", process.env["BEADS_DB"]);
}
function configDescription(operation: "show" | "history"): string {
	return {
		history: "Inspect immutable policy revision metadata",
		show: "Inspect active policy metadata",
	}[operation];
}

function failureReason(error: unknown): string | number {
	if (error instanceof CommanderError || error instanceof CommandError) {
		return error.code;
	}
	if (error instanceof DaemonUnavailableError) {
		return "daemon_unavailable";
	}
	if (
		error instanceof Error &&
		"code" in error &&
		(typeof error.code === "string" || typeof error.code === "number")
	) {
		return error.code;
	}
	return "operation_failed";
}
