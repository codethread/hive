import type { GitResult, GitRunner } from "../services.ts";
import { EXIT_CODES } from "../errors.ts";
import { GitError } from "./error.ts";
// :module: Git command execution utilities for honeycomb

export class LiveGitRunner implements GitRunner {
	async run(args: string[], opts: { cwd?: string } = {}): Promise<GitResult> {
		const result = await this.runRaw(args, opts);
		if (result.exitCode !== EXIT_CODES.SUCCESS) {
			throw new GitError(args, result.stderr, result.exitCode);
		}
		return result;
	}

	async runRaw(args: string[], opts: { cwd?: string } = {}): Promise<GitResult> {
		// A stable neutral cwd keeps git's own -C flag meaningful after a worktree deletes the process's original directory, and avoids accidental writes into $HOME.
		const proc = Bun.spawn(["git", ...args], {
			cwd: opts.cwd ?? "/",
			stderr: "pipe",
			stdout: "pipe",
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		return { exitCode, stderr, stdout };
	}
}

export { GitError } from "./error.ts";
