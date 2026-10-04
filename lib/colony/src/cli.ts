import { Command, CommanderError } from "commander";
import { CommandError } from "@hive/shared";
import type { DaemonResponse } from "./client.ts";
import { DaemonUnavailableError } from "./client.ts";
import type { InitializedResult } from "./producer.ts";
import type { LaunchedResult } from "./output.ts";
import { writeColonyResult } from "./output.ts";

const SUCCESS = 0;
const FAILURE = 1;
const USAGE_ERROR = 2;

export interface InitOptions {
	/** Canonical discovery directory. */
	repo: string;
	/** Human accountable for produced requests. */
	owner: string;
	/** Default worker model. */
	model: string;
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
		.description("Launch captured bee requests")
		.option("--json", "Emit errors as JSON too")
		.configureOutput({ writeErr: () => {}, writeOut: deps.stdout })
		.exitOverride();
	program
		.command("init")
		.description("Create canonical bees.toml without overwriting it")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.requiredOption("--owner <identity>", "Human request owner")
		.requiredOption("--model <model>", "Default Codex worker model")
		.action(async (options: InitOptions) => {
			writeColonyResult(await deps.init(options), argv.includes("--json"), deps.stdout);
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
		program.command("wake").description("Reload canonical policy and wake a repository"),
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
	const config = program
		.command("config")
		.description("Inspect or change active formula and limit policy");
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
	serverOptions(daemon.command("status").description("Inspect the running daemon")).action(
		async (options: ServerOptions) => {
			writeColonyResult(await deps.status(options), argv.includes("--json"), deps.stdout);
		},
	);
	serverOptions(daemon.command("stop").description("Stop the running daemon")).action(
		async (options: ServerOptions) => {
			writeColonyResult(await deps.stop(options), argv.includes("--json"), deps.stdout);
		},
	);
	try {
		await program.parseAsync(argv, { from: "user" });
		return SUCCESS;
	} catch (error) {
		return reportFailure(error, argv.includes("--json"), { ...deps, command: "colony" });
	}
}

// --- Private functions ---
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
	writeFailure({ message, reason: failureReason(error) }, json, deps);
	if (error instanceof CommanderError) {
		return USAGE_ERROR;
	}
	return FAILURE;
}
function writeFailure(
	failure: { message: string; reason: string | number },
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
		add: "Register a repository durably; new registrations start asleep",
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
