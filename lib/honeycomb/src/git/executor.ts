import { HoneycombError } from "../errors.ts";
import type { GitResult, GitRunner } from "../services.ts";
// :module: Git command execution utilities for honeycomb

export class GitError extends HoneycombError {
	override readonly reason = "git_failed";
	args: string[];
	stderr: string;
	gitExitCode: number;
	constructor(args: string[], stderr: string, gitExitCode: number) {
		super(`git ${args.join(" ")} failed: ${stderr.trim()}`);
		this.args = args;
		this.stderr = stderr;
		this.gitExitCode = gitExitCode;
	}
}

export class LiveGitRunner implements GitRunner {
	async run(args: string[], opts: { cwd?: string } = {}): Promise<GitResult> {
		const result = await this.runRaw(args, opts);
		if (result.exitCode !== 0) {
			throw new GitError(args, result.stderr, result.exitCode);
		}
		return result;
	}

	async runRaw(args: string[], opts: { cwd?: string } = {}): Promise<GitResult> {
		// Use a stable neutral cwd when callers rely on git's own -C flag. This keeps
		// cleanup commands working after a worktree deletes the process's original cwd,
		// while avoiding accidental writes into the user's home directory.
		const proc = Bun.spawn(["git", ...args], {
			cwd: opts.cwd ?? "/",
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		return { stdout, stderr, exitCode };
	}
}
