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
import { removeCommand } from "./commands/remove.ts";
import { EXIT_CODES } from "./errors.ts";
import type { CommandResult } from "./protocol.ts";
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

Options:
  -h, --help  Show this help message
`;

export const dispatch = async (
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
		default:
			return { stderr: USAGE, exitCode: EXIT_CODES.USAGE };
	}
};
