import type { CommandResult, OutputMode } from "./protocol.ts";
import {
	configCommand,
	copyCommand,
	ensureCommand,
	listCommand,
	pathCommand,
	rootCommand,
	statusCommand,
} from "./commands/query.ts";
import { createJsonCollector, formatFailure } from "./protocol.ts";
import type { Deps } from "./services.ts";
import { EXIT_CODES } from "./errors.ts";
import { addCommand } from "./commands/add.ts";
import { finishCommand } from "./commands/finish.ts";
import { pickCommand } from "./commands/pick.ts";
import { removeCommand } from "./commands/remove.ts";
import { shellInitCommand } from "./commands/shell-init.ts";

const USAGE = `honeycomb - reusable git worktree pool manager

Usage: honeycomb <subcommand> [options]

Subcommands:
  root      Print canonical worktree root
  list      List worktrees
  path      Print worktree path for branch
  add       Add or allocate a worktree
  remove    Remove a worktree or free a pooled slot
  ensure    Materialise pooled worktree slots
  status    Print pool status JSON
  copy      Re-run configured copy setup
  config    Inspect effective configuration
  finish    Integrate a completed worktree into the canonical root
  pick      Fuzzy-pick a worktree to switch to
  shell-init Print a wk picker function for zsh or nu

Options:
  --interactive  Follow the command with multiplexer focus and the cd directive
  -h, --help     Show this help message
`;

interface Invocation {
	/** Command selected by the caller. */
	subcommand: string | undefined;
	/** Raw command arguments. */
	args: string[];
	/** Requested output format. */
	output: OutputMode;
}

const handlers: Partial<
	Record<string, (args: string[], deps: Deps) => Promise<CommandResult> | CommandResult>
> = {
	add: addCommand,
	config: configCommand,
	copy: copyCommand,
	ensure: ensureCommand,
	finish: finishCommand,
	list: listCommand,
	path: pathCommand,
	pick: pickCommand,
	remove: removeCommand,
	root: rootCommand,
	"shell-init": shellInitCommand,
	status: statusCommand,
};

const route = (request: Invocation, deps: Deps): CommandResult | Promise<CommandResult> => {
	const { args, subcommand } = request;
	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		return { exitCode: EXIT_CODES.SUCCESS, stdout: USAGE };
	}
	if (Object.hasOwn(handlers, subcommand)) {
		const handler = handlers[subcommand];
		if (handler) {
			return handler(args, deps);
		}
	}
	return { exitCode: EXIT_CODES.USAGE, stderr: USAGE };
};

const routeFormatted = async (request: Invocation, deps: Deps): Promise<CommandResult> => {
	try {
		return await route(request, deps);
	} catch (error) {
		return formatFailure(error, request.output);
	}
};

/** Format every command failure and capture progress for machine-readable invocations. */
const dispatch = async (
	subcommand: string | undefined,
	args: string[],
	deps: Deps,
): Promise<CommandResult> => {
	const output: OutputMode = { json: subcommand === "status" || args.includes("--json") };
	const request = { args, output, subcommand };
	if (!output.json) {
		return routeFormatted(request, deps);
	}
	const collector = createJsonCollector(deps.progress);
	const result = await routeFormatted(request, { ...deps, progress: collector.progress });
	return collector.render(result);
};

export { dispatch };
