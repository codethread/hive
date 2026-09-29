import {
	NoMultiplexer,
	WORKTREE_PATH_FIELD,
	type Multiplexer,
	type MultiplexerOpenRequest,
} from "./multiplexer.ts";

/** Result of one external command. */
export interface CommandResult {
	/** Captured standard output. */
	stdout: string;
	/** Captured diagnostics. */
	stderr: string;
	/** Process exit status. */
	exitCode: number;
}

/** Process boundary for multiplexer commands. */
export interface CommandRunner {
	/** Run a command and return its exit status and captured output. */
	run(command: string, args: string[]): Promise<CommandResult>;
}

export class LiveCommandRunner implements CommandRunner {
	async run(command: string, args: string[]): Promise<CommandResult> {
		// Keep a stable neutral cwd: interactive cleanup closes sessions after removing
		// the worktree that may contain the process's original directory.
		const proc = Bun.spawn([command, ...args], { cwd: "/", stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	}
}

export class TmuxError extends Error {
	args: string[];
	stderr: string;
	tmuxExitCode: number;
	constructor(args: string[], stderr: string, tmuxExitCode: number) {
		super(`tmux ${args.join(" ")} failed: ${stderr.trim()}`);
		this.args = args;
		this.stderr = stderr;
		this.tmuxExitCode = tmuxExitCode;
		this.name = "TmuxError";
	}
}

/** tmux state inherited from the invoking process. */
export interface TmuxEnvironment {
	/** Server/session identity; present when honeycomb runs inside tmux. */
	TMUX?: string | undefined;
	/** Pane that invoked honeycomb, used to resolve the client to switch. */
	TMUX_PANE?: string | undefined;
}

/** Session observed through tmux. */
export interface TmuxSession {
	/** Session name. */
	name: string;
	/** Directory the session was created in. */
	path: string;
}

const TAB = "\t";
const SESSION_LIST_FORMAT = `#{session_name}${TAB}#{session_path}`;
const PANE_LIST_FORMAT = `#{pane_id}${TAB}#{pane_current_path}`;
const NOTHING_TO_CLOSE = /no server running|no sessions/;

export class TmuxMultiplexer implements Multiplexer {
	readonly attached = true;
	private readonly runner: CommandRunner;
	private readonly env: TmuxEnvironment;

	constructor(runner: CommandRunner, env: TmuxEnvironment) {
		this.runner = runner;
		this.env = env;
	}

	async open(request: MultiplexerOpenRequest): Promise<void> {
		const target = `=${request.name}`;
		const existing = await this.runner.run("tmux", ["has-session", "-t", target]);
		if (existing.exitCode !== 0) {
			await this.run([
				"new-session",
				"-d",
				"-s",
				request.name,
				"-n",
				request.title,
				"-c",
				request.path,
			]);
		}
		const client = await this.invokingClient();
		await this.run(["switch-client", ...(client ? ["-c", client] : []), "-t", target]);
	}

	async closeUnder(path: string): Promise<void> {
		const args = ["list-sessions", "-F", SESSION_LIST_FORMAT];
		const listed = await this.runner.run("tmux", args);
		if (listed.exitCode !== 0) {
			// An absent server or no sessions means nothing to close; anything else is a failure.
			if (NOTHING_TO_CLOSE.test(listed.stderr)) return;
			throw new TmuxError(args, listed.stderr, listed.exitCode);
		}
		for (const session of parseSessionList(listed.stdout)) {
			if (!pathContains(path, session.path)) continue;
			await this.run(["kill-session", "-t", `=${session.name}`]);
		}
	}

	previewCommand(): string {
		return [
			`path=${WORKTREE_PATH_FIELD}`,
			`pane=$(tmux list-panes -a -F '${PANE_LIST_FORMAT}' 2>/dev/null | awk -F '\\t' -v path="$path" '$2 == path || index($2, path "/") == 1 { print $1; exit }')`,
			`[ -n "$pane" ] && tmux capture-pane -ep -t "$pane" 2>/dev/null || git -C "$path" log --oneline -20`,
		].join("; ");
	}

	/** Client whose focus switch-client should move; absent when the pane cannot be resolved. */
	private async invokingClient(): Promise<string | null> {
		const pane = this.env.TMUX_PANE;
		if (!pane) return null;
		const result = await this.runner.run("tmux", [
			"display-message",
			"-p",
			"-t",
			pane,
			"#{client_tty}",
		]);
		if (result.exitCode !== 0) return null;
		const client = result.stdout.trim();
		return client === "" ? null : client;
	}

	/** Run tmux, surfacing a nonzero exit as TmuxError. */
	private async run(args: string[]): Promise<void> {
		const result = await this.runner.run("tmux", args);
		if (result.exitCode !== 0) throw new TmuxError(args, result.stderr, result.exitCode);
	}
}

/** Parse name/path rows from list-sessions, skipping rows without both fields. */
export const parseSessionList = (output: string): TmuxSession[] => {
	const sessions: TmuxSession[] = [];
	for (const line of output.split("\n")) {
		const parts = line.split(TAB);
		const name = parts[0];
		const path = parts[1];
		if (!name || !path) continue;
		sessions.push({ name, path });
	}
	return sessions;
};

const pathContains = (parent: string, child: string): boolean =>
	child === parent || child.startsWith(`${parent}/`);

/** Select tmux when the process runs inside it, otherwise the null implementation. */
export const selectMultiplexer = (env: TmuxEnvironment): Multiplexer =>
	env.TMUX ? new TmuxMultiplexer(new LiveCommandRunner(), env) : new NoMultiplexer();
