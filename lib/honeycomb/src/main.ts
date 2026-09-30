import { addCommand } from "./commands/add.ts";
import { finishCommand } from "./commands/finish.ts";
import {
	configCommand,
	copyCommand,
	ensureCommand,
	listCommand,
	pathCommand,
	rootCommand,
	statusCommand,
} from "./commands/query.ts";
import { pickCommand } from "./commands/pick.ts";
import { removeCommand } from "./commands/remove.ts";
import { EXIT_CODES } from "./errors.ts";
import {
	type CommandResult,
	type OutputMode,
	createJsonCollector,
	formatFailure,
} from "./protocol.ts";
import type { Deps } from "./services.ts";

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

Options:
  --interactive  Follow the command with multiplexer focus and the cd directive
  -h, --help     Show this help message
`;

/**
 * The command boundary: every throw is formatted here. With --json (and for status,
 * which is always JSON), stdout is one document and progress is captured into it.
 */
export const dispatch = async (
	subcommand: string | undefined,
	args: string[],
	deps: Deps,
): Promise<CommandResult> => {
	const output: OutputMode = { json: subcommand === "status" || args.includes("--json") };
	if (!output.json) return routeFormatted(subcommand, args, deps, output);
	const collector = createJsonCollector(deps.progress);
	const result = await routeFormatted(
		subcommand,
		args,
		{ ...deps, progress: collector.progress },
		output,
	);
	return collector.render(result);
};

const routeFormatted = async (
	subcommand: string | undefined,
	args: string[],
	deps: Deps,
	output: OutputMode,
): Promise<CommandResult> => {
	try {
		return await route(subcommand, args, deps);
	} catch (error) {
		return formatFailure(error, output);
	}
};

const route = async (
	subcommand: string | undefined,
	args: string[],
	deps: Deps,
): Promise<CommandResult> => {
	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		return { stdout: USAGE, exitCode: 0 };
	}

	switch (subcommand) {
		case "root":
			return rootCommand(args, deps);
		case "list":
			return listCommand(args, deps);
		case "path":
			return pathCommand(args, deps);
		case "add":
			return addCommand(args, deps);
		case "remove":
			return removeCommand(args, deps);
		case "status":
			return statusCommand(args, deps);
		case "ensure":
			return ensureCommand(args, deps);
		case "copy":
			return copyCommand(args, deps);
		case "config":
			return configCommand(args, deps);
		case "finish":
			return finishCommand(args, deps);
		case "pick":
			return pickCommand(args, deps);
		default:
			return { stderr: USAGE, exitCode: EXIT_CODES.USAGE };
	}
};
