import type { Multiplexer, MultiplexerOpenRequest } from "./multiplexer.ts";
import { NoMultiplexer, WORKTREE_PATH_FIELD } from "./multiplexer.ts";
import type { CommandRunner } from "./command-runner.ts";
import { EXIT_CODES } from "../errors.ts";
import { LiveCommandRunner } from "./command-runner.ts";
import { TmuxError } from "./tmux-error.ts";

/** Tmux state inherited from the invoking process. */
interface TmuxEnvironment {
	/** Server/session identity; present when honeycomb runs inside tmux. */
	TMUX?: string | undefined;
	/** Pane that invoked honeycomb, used to resolve the client to switch. */
	TMUX_PANE?: string | undefined;
}

/** Session observed through tmux. */
interface TmuxSession {
	/** Session name. */
	name: string;
	/** Directory the session was created in. */
	path: string;
}

const TAB = "\t";
const SESSION_LIST_FORMAT = `#{session_name}${TAB}#{session_path}`;
const PANE_LIST_FORMAT = `#{pane_id}${TAB}#{pane_current_path}`;
const NOTHING_TO_CLOSE = /no server running|no sessions/u;

const pathContains = (parent: string, child: string): boolean =>
	child === parent || child.startsWith(`${parent}/`);

class TmuxMultiplexer implements Multiplexer {
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
		if (existing.exitCode !== EXIT_CODES.SUCCESS) {
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
		const switchArgs = ["switch-client"];
		if (client !== undefined) {
			switchArgs.push("-c", client);
		}
		switchArgs.push("-t", target);
		await this.run(switchArgs);
	}

	async closeUnder(path: string): Promise<void> {
		const args = ["list-sessions", "-F", SESSION_LIST_FORMAT];
		const listed = await this.runner.run("tmux", args);
		if (listed.exitCode !== EXIT_CODES.SUCCESS) {
			// An absent server or no sessions means nothing to close; anything else is a failure.
			if (NOTHING_TO_CLOSE.test(listed.stderr)) {
				return;
			}
			throw new TmuxError(args, listed.stderr, listed.exitCode);
		}
		for (const session of parseSessionList(listed.stdout)) {
			if (pathContains(path, session.path)) {
				// Kill sessions one at a time so the first tmux failure surfaces deterministically.
				// oxlint-disable-next-line eslint/no-await-in-loop
				await this.run(["kill-session", "-t", `=${session.name}`]);
			}
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
	private async invokingClient(): Promise<string | undefined> {
		const pane = this.env.TMUX_PANE;
		if (!pane) {
			return;
		}
		const result = await this.runner.run("tmux", [
			"display-message",
			"-p",
			"-t",
			pane,
			"#{client_tty}",
		]);
		if (result.exitCode !== EXIT_CODES.SUCCESS) {
			return;
		}
		const client = result.stdout.trim();
		if (client === "") {
			return;
		}
		return client;
	}

	/** Run tmux, surfacing a nonzero exit as TmuxError. */
	private async run(args: string[]): Promise<void> {
		const result = await this.runner.run("tmux", args);
		if (result.exitCode !== EXIT_CODES.SUCCESS) {
			throw new TmuxError(args, result.stderr, result.exitCode);
		}
	}
}

/** Parse name/path rows from list-sessions, skipping rows without both fields. */
const parseSessionList = (output: string): TmuxSession[] => {
	const sessions: TmuxSession[] = [];
	for (const line of output.split("\n")) {
		const [name, path] = line.split(TAB);
		if (name && path) {
			sessions.push({ name, path });
		}
	}
	return sessions;
};

/** Select tmux when the process runs inside it, otherwise the null implementation. */
const selectMultiplexer = (env: TmuxEnvironment): Multiplexer => {
	if (env.TMUX) {
		return new TmuxMultiplexer(new LiveCommandRunner(), env);
	}
	return new NoMultiplexer();
};

export { parseSessionList, selectMultiplexer, TmuxMultiplexer };
export { LiveCommandRunner } from "./command-runner.ts";
export type { CommandResult, CommandRunner } from "./command-runner.ts";
export { TmuxError } from "./tmux-error.ts";
export type { TmuxEnvironment, TmuxSession };
