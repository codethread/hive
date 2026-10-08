import { Command, CommanderError } from "commander";
import { EXIT_CODES, UsageError } from "./errors.ts";
import { formatFailure, renderJsonResult } from "./protocol.ts";
import type { CommandResult } from "./protocol.ts";
import type { Deps } from "./services.ts";
import { HELP } from "./cli-help.ts";
import { createLiveDeps } from "./live-deps.ts";
import { dispatch } from "./main.ts";
import tab from "@bomb.sh/tab/commander";

const registrations = [
	registerRoot,
	registerList,
	registerTree,
	registerPath,
	registerAdd,
	registerRemove,
	registerEnsure,
	registerStatus,
	registerCopy,
	registerFinish,
	registerPick,
	registerShellInit,
	registerConfig,
];

export async function main(
	argv: string[] = Bun.argv,
	deps: Deps = createLiveDeps(),
): Promise<void> {
	// Commander may reject arguments before dispatch can format them.
	const json = argv.includes("--json");
	const program = createProgram(json);
	for (const register of registrations) {
		register(program, deps);
	}
	configureCompletion(program);
	await parseProgram(program, argv, json);
}
// --- Private functions ---

function createProgram(json: boolean): Command {
	const program = new Command();
	program
		.name("honeycomb")
		.version("0.5.0")
		.summary("Manage git worktrees deterministically")
		.description(
			"Deterministic git worktree lifecycle engine for humans, agents, shells, and tmux wrappers.",
		)
		.option(
			"--cwd <path>",
			"Path inside the worktree set to operate on; defaults to the current directory",
			process.cwd(),
		)
		.option(
			"--interactive",
			"Human wrapper mode: add opens the worktree's multiplexer session; remove and finish leave and close it",
		)
		.configureOutput({
			writeErr: (str) => {
				if (!json) {
					process.stderr.write(str);
				}
			},
			writeOut: (str) => process.stderr.write(str),
		})
		.addHelpText("after", HELP.overview)
		.exitOverride();

	return program;
}

function registerRoot(program: Command, deps: Deps): void {
	program
		.command("root")
		.summary("Print canonical root")
		.description(
			"Print the protected canonical/root worktree for the repository containing --cwd (or the current directory by default).",
		)
		.addHelpText("after", HELP.root)
		.action((_opts, command) => runAction("root", optsToArgs(command.optsWithGlobals()), deps));
}

function registerList(program: Command, deps: Deps): void {
	program
		.command("list")
		.summary("List worktrees")
		.description(
			"List every git worktree known to the repository, including canonical and pooled slots.",
		)
		.option("--json", "Output as JSON")
		.addHelpText("after", HELP.list)
		.action((_opts, command) => runAction("list", optsToArgs(command.optsWithGlobals()), deps));
}

function registerTree(program: Command, deps: Deps): void {
	program
		.command("tree")
		.summary("Show worktree ancestry")
		.description("Render registered worktrees as a tree inferred from current Git commit ancestry.")
		.option("--json", "Output as JSON")
		.addHelpText("after", HELP.tree)
		.action((_opts, command) => runAction("tree", optsToArgs(command.optsWithGlobals()), deps));
}

function registerPath(program: Command, deps: Deps): void {
	program
		.command("path")
		.summary("Resolve branch path")
		.description(
			"Print the deterministic worktree path for a branch in the repository containing --cwd (or the current directory by default).",
		)
		.requiredOption("--branch <branch>", "Branch name")
		.addHelpText("after", HELP.path)
		.action((_opts, command) => runAction("path", optsToArgs(command.optsWithGlobals()), deps));
}

function registerAdd(program: Command, deps: Deps): void {
	program
		.command("add")
		.summary("Create or allocate worktree")
		.description(
			"Create a regular worktree or allocate a pooled slot for a branch, applying add policy and setup.",
		)
		.requiredOption("--branch <branch>", "Branch name")
		.option("--json", "Machine-readable output")
		.option("--slot <path>", "Specific pool slot path")
		.option("--base <branch>", "Base branch for new branches")
		.option("--base-current", "Use the branch checked out in the worktree containing --cwd")
		.option("--force", "Force operation")
		.addHelpText("after", HELP.add)
		.action((_opts, command) => runAction("add", optsToArgs(command.optsWithGlobals()), deps));
}

function registerRemove(program: Command, deps: Deps): void {
	program
		.command("remove")
		.summary("Remove worktree")
		.description(
			"Remove a regular worktree or free a pooled worktree slot, refusing unsafe states unless forced.",
		)
		.option("--branch <branch>", "Branch to remove")
		.option("--self", "Remove the worktree containing --cwd")
		.option("--json", "Machine-readable output")
		.option("--force", "Force removal")
		.option("--keep-branch", "Remove/free worktree without deleting branch")
		.option(
			"--integrated-into <origin/ref>",
			"Delete a clean branch only after proving its content is in this fetched ref",
		)
		.addHelpText("after", HELP.remove)
		.action((_opts, command) => runAction("remove", optsToArgs(command.optsWithGlobals()), deps));
}

function registerEnsure(program: Command, deps: Deps): void {
	program
		.command("ensure")
		.summary("Materialise pool slots")
		.description("Create and initialize the configured fixed pool slots for a pooled repository.")
		.addHelpText("after", HELP.ensure)
		.action((_opts, command) => runAction("ensure", optsToArgs(command.optsWithGlobals()), deps));
}

function registerStatus(program: Command, deps: Deps): void {
	program
		.command("status")
		.summary("Show pool status")
		.description(
			"Print JSON describing configured pool size and each slot's branch, safety, and initialization state.",
		)
		.addHelpText("after", HELP.status)
		.action((_opts, command) => runAction("status", optsToArgs(command.optsWithGlobals()), deps));
}

function registerCopy(program: Command, deps: Deps): void {
	program
		.command("copy")
		.summary("Re-run copy setup")
		.description(
			"Re-apply configured local file/directory copy or symlink setup to the current non-canonical worktree.",
		)
		.option("--json", "Machine-readable output")
		.addHelpText("after", HELP.copy)
		.action((_opts, command) => runAction("copy", optsToArgs(command.optsWithGlobals()), deps));
}

function registerFinish(program: Command, deps: Deps): void {
	program
		.command("finish")
		.summary("Integrate completed work")
		.description(
			"Integrate the current non-canonical worktree into the canonical root using effective finish policy.",
		)
		.option("--json", "Machine-readable output")
		.option("--title <text>", "Squash integration commit title; required by the squash strategy")
		.option(
			"--body <text>",
			"Squash integration commit body; the source branch and its commit messages are appended",
		)
		.addHelpText("after", HELP.finish)
		.action((_opts, command) => runAction("finish", optsToArgs(command.optsWithGlobals()), deps));
}

function registerPick(program: Command, deps: Deps): void {
	program
		.command("pick")
		.summary("Fuzzy-pick worktree")
		.description(
			"Fuzzy-pick a worktree with fzf and print its path, or with --interactive hand it to the invoking shell or open its multiplexer session.",
		)
		.option("--open", "Open the selection's multiplexer session instead of printing its path")
		.addHelpText("after", HELP.pick)
		.action((_opts, command) => runAction("pick", optsToArgs(command.optsWithGlobals()), deps));
}

function registerShellInit(program: Command, deps: Deps): void {
	program
		.command("shell-init <shell>")
		.summary("Print shell integration")
		.description("Print a wk picker function for zsh or nu; does not require a repository.")
		.addHelpText("after", HELP.shellInit)
		.action((shell: string) => runAction("shell-init", [shell], deps));
}

function registerConfig(program: Command, deps: Deps): void {
	program
		.command("config")
		.summary("Inspect configuration")
		.description("Inspect effective honeycomb configuration and policy.")
		.addHelpText("after", HELP.config)
		.command("explain")
		.summary("Explain effective config")
		.description(
			"Show effective policy, bootstrap command source, and matching config layers for a repository.",
		)
		.option("--json", "Machine-readable output")
		.addHelpText("after", HELP.explain)
		.action((_opts, command) =>
			runAction("config", ["explain", ...optsToArgs(command.optsWithGlobals())], deps),
		);
}

function configureCompletion(program: Command): void {
	const completion = tab(program, { completionCommandName: "completions" });
	// The adapter collects local options only; Commander also accepts root options on subcommands.
	for (const command of completion.commands.values()) {
		for (const [name, option] of completion.options) {
			if (!command.options.has(name)) {
				command.options.set(name, option);
			}
		}
	}
}

async function handleParseError(error: unknown, json: boolean): Promise<void> {
	if (!(error instanceof CommanderError)) {
		throw error;
	}
	if (error.exitCode === EXIT_CODES.SUCCESS) {
		process.exit(EXIT_CODES.SUCCESS);
	}
	if (!json) {
		process.exit(EXIT_CODES.USAGE);
	}
	const usage = new UsageError(error.message.replace(/^error: /u, ""));
	await writeResult(renderJsonResult(formatFailure(usage, { json })));
	process.exit(EXIT_CODES.USAGE);
}

async function parseProgram(program: Command, argv: string[], json: boolean): Promise<void> {
	try {
		await program.parseAsync(argv);
	} catch (error) {
		await handleParseError(error, json);
	}
}

async function runAction(subcmd: string, args: string[], deps: Deps): Promise<void> {
	const result = await dispatch(subcmd, args, deps);
	await writeResult(result);
	await result.afterOutput?.();
	process.exit(result.exitCode);
}

// Await the writes: afterOutput may close the invoking session and end this process.
async function writeResult(result: CommandResult): Promise<void> {
	if (result.stdout) {
		await Bun.write(Bun.stdout, result.stdout);
	}
	if (result.stderr) {
		await Bun.write(Bun.stderr, result.stderr);
	}
}

function optsToArgs(opts: Record<string, unknown>): string[] {
	const args: string[] = [];
	for (const [key, value] of Object.entries(opts)) {
		const flag = key.replaceAll(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`);
		if (value === true) {
			args.push(`--${flag}`);
		} else if (value !== false && value !== undefined && value !== null) {
			args.push(`--${flag}`, String(value));
		}
	}
	return args;
}
