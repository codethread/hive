import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	closeSync,
	mkdtempSync,
	openSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveHookRunner } from "../../src/hooks.ts";
import { LiveGitRunner } from "../../src/git/executor.ts";
import { HookError } from "../../src/errors.ts";

describe("LiveHookRunner", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-hook-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("streams output while the hook waits for a response", async () => {
		const fifo = join(tmp, "response");
		const mkfifo = Bun.spawn(["mkfifo", fifo], { stdout: "pipe", stderr: "pipe" });
		expect(await mkfifo.exited).toBe(0);
		const script = join(tmp, "hook.sh");
		// A response from the first-line callback is required for the hook to finish.
		// Opening both ends avoids blocking on FIFO open; read's deadline bounds a regression.
		writeFileSync(
			script,
			'exec 3<> "$RESPONSE_FIFO"\necho first\nIFS= read -r -t 2 -u 3 response || exit 8\necho "$response"\n',
		);
		const response = openSync(fifo, "r+");
		try {
			const seen: string[] = [];
			await new LiveHookRunner().runInline(script, tmp, { RESPONSE_FIFO: fifo }, (stream, line) => {
				seen.push(`${stream}:${line}`);
				if (line === "first") writeSync(response, "second\n");
			});
			expect(seen).toEqual(["stdout:first", "stdout:second"]);
		} finally {
			closeSync(response);
		}
	});

	test("throws HookError with exit code and slot path on failure", async () => {
		const script = join(tmp, "hook.sh");
		writeFileSync(script, "echo bad >&2\nexit 7\n");
		chmodSync(script, 0o755);
		const runner = new LiveHookRunner();

		try {
			await runner.runInline(script, tmp, {}, () => undefined);
			throw new Error("expected hook to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HookError);
			expect((error as HookError).hookExitCode).toBe(7);
			expect((error as HookError).slotPath).toBe(tmp);
		}
	});
});

describe("LiveGitRunner", () => {
	test("runs git --version", async () => {
		const git = new LiveGitRunner();
		const result = await git.run(["--version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("git version");
	});

	test("runs git even when the process cwd was removed", async () => {
		const directory = mkdtempSync(join(tmpdir(), "honeycomb-git-cwd-test-"));
		const executor = new URL("../../src/git/executor.ts", import.meta.url).href;
		try {
			const child = Bun.spawn(
				[
					"bun",
					"-e",
					`
    import { mkdirSync, rmSync } from "node:fs";
    import { LiveGitRunner } from ${JSON.stringify(executor)};
    const doomed = ${JSON.stringify(join(directory, "deleted-worktree"))};
    mkdirSync(doomed);
    process.chdir(doomed);
    rmSync(doomed, { recursive: true });
    const result = await new LiveGitRunner().run(["--version"]);
    process.stdout.write(result.stdout);
   `,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect({ exitCode, stderr, stdout }).toEqual({
				exitCode: 0,
				stderr: "",
				stdout: expect.stringContaining("git version"),
			});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
