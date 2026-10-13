import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import type { Dependencies, Outcome, Request, TicketRequest } from "./run.ts";
import { EXIT, QlockError, READY_WINDOW_MS } from "./queue.ts";
import { normalizeError, runRequest } from "./run.ts";
import type { Ticket } from "./queue.ts";

const FIRST = 0;
const AFTER_FIRST = 1;
const MAX_EXIT_CODE = 255;
const FOREVER = -1;
const SECONDS = 1000;
// eslint-disable-next-line unicorn/no-null -- The public queue contract uses null for the ordinary FIFO lane.
const ORDINARY = null;
const HELP = `
Merge queue (instead of --lock):
  qlock exec --merge-target main -w 180 -- honeycomb finish --json
`;
const EXEC_HELP = `
Example: wait, timeout, resume
  qlock exec --lock /tmp/check.lock -w 180 -- bun run check
  # Queue wait timeout (-w, not command runtime): exit 75; stderr:
  qlock: Ticket 42 still queued (#2/2); resume with --ticket 42 before --

  # Run again with the reported ID (here 42), same queue and command
  qlock exec --lock /tmp/check.lock -w 180 --ticket 42 -- bun run check

--ticket keeps your place; omit it to join again.
No background execution. Ready tickets expire after 30s.
`;

interface TargetOptions {
	/** Explicit caller-supplied lock path. */
	lock?: string;
	/** Normalized destination ref instead of an explicit lock path. */
	mergeTarget?: string;
}

interface StatusOptions extends TargetOptions {
	/** Machine metadata selection. */
	json?: boolean;
}

interface ExecOptions extends TargetOptions {
	/** Whole seconds to wait; -1 waits forever. */
	wait: number;
	/** Exit status when the wait times out. */
	timeoutCode: number;
	/** Supplied only when resuming an existing ticket. */
	ticket?: number;
	/** Urgent-lane justification for a new ticket; conflicts with ticket. */
	urgent?: string;
}

/** Own parsing and output only; queue and process work uses injected dependencies. */
export async function runCli(argv: readonly string[], deps: Dependencies): Promise<number> {
	let exitCode: number = EXIT.success;
	const program = createProgram(deps, async (request, json) => {
		const result = await runRequest(request, deps);
		if (result.kind === "executed") {
			exitCode = result.code;
		} else {
			writeResult(result, json, deps);
		}
	});
	let selected = program;
	program.hook("preSubcommand", (_parent, command) => {
		selected = command;
	});
	try {
		await program.parseAsync(argv, { from: "user" });
		return exitCode;
	} catch (error) {
		return reportFailure(error, selected.opts<StatusOptions>(), deps);
	}
}

// --- Private functions ---

function createProgram(
	deps: Dependencies,
	action: (request: Request, json: boolean) => Promise<void>,
): Command {
	const program = new Command()
		.name("qlock")
		.description("Ticketed local command queues for agents and shells")
		.enablePositionalOptions()
		.addHelpText("after", EXEC_HELP + HELP)
		.configureOutput({ writeOut: deps.stdout, writeErr: () => {} })
		.exitOverride();

	queueCommand(program.command("exec"))
		.description("Queue and run a command")
		.usage("[options] -- <command> [args...]")
		.argument("<command>", "Executable to run", nonblank)
		.argument("[args...]", "Arguments passed to the command")
		.addHelpText("after", EXEC_HELP)
		.requiredOption(
			"-w, --wait <seconds>",
			"Queue wait in whole seconds; -1 waits forever",
			(value) => integer(value, FOREVER, Math.floor(Number.MAX_SAFE_INTEGER / SECONDS)),
		)
		.option(
			"-E, --timeout-code <code>",
			"Wait-timeout exit status",
			(value) => integer(value, AFTER_FIRST, MAX_EXIT_CODE),
			EXIT.queued,
		)
		.option("--ticket <id>", "Resume this ticket instead of joining again", (value) =>
			integer(value, AFTER_FIRST, Number.MAX_SAFE_INTEGER),
		)
		.addOption(
			new Option("--urgent <reason>", "Join the urgent lane with a new ticket")
				.conflicts("ticket")
				.argParser(nonblank),
		)
		.action(async function exec(this: Command, command: string, args: string[]) {
			const options = this.opts<ExecOptions>();
			let ticket: TicketRequest = { kind: "new", urgent: options.urgent ?? ORDINARY };
			if (options.ticket !== undefined) {
				ticket = { kind: "existing", id: options.ticket };
			}
			await action(
				{
					target: lockTarget(options),
					operation: {
						kind: "exec",
						command: [command, ...args],
						ticket,
						waitSeconds: options.wait,
						timeoutCode: options.timeoutCode,
					},
				},
				false,
			);
		});
	queueCommand(program.command("status"))
		.description("Inspect the running command and queue")
		.option("--json", "One JSON result or error; put first")
		.addHelpText("after", "\nExample:\n  qlock status --json --lock /tmp/check.lock\n")
		.action(async function status(this: Command) {
			const options = this.opts<StatusOptions>();
			await action(
				{ target: lockTarget(options), operation: { kind: "status" } },
				options.json === true,
			);
		});
	return program;
}

function queueCommand(command: Command): Command {
	return command
		.addOption(
			new Option("--lock <path>", "Queue lock path").conflicts("mergeTarget").argParser(nonblank),
		)
		.option(
			"--merge-target <branch>",
			"Use a repository/branch queue instead of --lock",
			branchRef,
		);
}

function lockTarget(options: TargetOptions): Request["target"] {
	if (options.mergeTarget !== undefined) {
		return { kind: "merge", ref: options.mergeTarget };
	}
	if (options.lock === undefined) {
		usage("provide --lock <path> or --merge-target <branch>");
	}
	return { kind: "path", path: options.lock };
}

function integer(value: string, minimum: number, maximum: number): number {
	const result = Number(value);
	if (
		!/^-?\d+$/u.test(value) ||
		!Number.isSafeInteger(result) ||
		result < minimum ||
		result > maximum
	) {
		throw new InvalidArgumentError(`must be a whole number from ${minimum} to ${maximum}`);
	}
	return result;
}

function nonblank(value: string): string {
	if (!value.trim()) {
		throw new InvalidArgumentError("must not be blank");
	}
	return value;
}

function branchRef(value: string): string {
	if (!value || (value.startsWith("refs/") && !value.startsWith("refs/heads/"))) {
		throw new InvalidArgumentError("requires a branch name or refs/heads/<branch>");
	}
	if (value.startsWith("refs/heads/")) {
		return value;
	}
	return `refs/heads/${value}`;
}

function reportFailure(error: unknown, options: StatusOptions, deps: Dependencies): number {
	if (error instanceof CommanderError && error.exitCode === EXIT.success) {
		return EXIT.success;
	}
	let failure = normalizeError(error);
	if (error instanceof CommanderError) {
		failure = new QlockError("usage", error.message, EXIT.usage);
	}
	if (options.json === true) {
		deps.stdout(
			`${JSON.stringify({
				ok: false,
				kind: "error",
				reason: failure.reason,
				message: failure.message,
				target: unresolvedTarget(options, failure.context.lock),
				...failure.context,
			})}\n`,
		);
	} else {
		deps.stderr(`qlock: ${failure.message}\n`);
	}
	return failure.exitCode;
}

/** Preserve parsed selectors without presenting them as an already-resolved queue. */
function unresolvedTarget(
	options: TargetOptions,
	resolvedLock: string | undefined,
): TargetOptions | undefined {
	if (resolvedLock !== undefined) {
		return undefined;
	}
	let target: TargetOptions | undefined = undefined;
	if (options.lock !== undefined) {
		target = { lock: options.lock };
	}
	if (options.mergeTarget !== undefined) {
		target = { ...target, mergeTarget: options.mergeTarget };
	}
	return target;
}

function writeResult(
	result: Exclude<Outcome, { kind: "executed" }>,
	json: boolean,
	deps: Dependencies,
): void {
	if (json) {
		deps.stdout(`${JSON.stringify({ ok: true, ...result })}\n`);
		return;
	}
	if (result.tickets.length === FIRST) {
		deps.stdout("free\n");
	} else {
		deps.stdout(
			result.tickets
				.map((ticket, index) => `#${index + AFTER_FIRST} ${describeTicket(ticket, deps.now())}\n`)
				.join(""),
		);
	}
}

function describeTicket(ticket: Ticket, now: number): string {
	let state: string = ticket.state;
	if (ticket.state === "running") {
		state = `running pid ${ticket.pid} ${JSON.stringify(ticket.command)}`;
	}
	if (ticket.state === "ready") {
		state = `ready, ${Math.max(FIRST, Math.ceil((READY_WINDOW_MS - now + ticket.readyAt) / SECONDS))}s left to exec`;
	}
	let urgent = "";
	if (ticket.urgent !== null) {
		urgent = ` [urgent: ${ticket.urgent}]`;
	}
	return `ticket ${ticket.id} ${state} (${ticket.cwd})${urgent}`;
}

function usage(message: string): never {
	throw new QlockError("usage", message, EXIT.usage);
}
