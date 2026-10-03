import { EXIT_CODES, HookError } from "../../src/errors.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { closeSync, openSync, writeSync } from "node:fs";
import { LiveGitRunner } from "../../src/git/executor.ts";
import { LiveHookRunner } from "../../src/hooks.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { tmpdir } from "node:os";

const HOOK_FAILURE_CODE = 7;
const EXECUTABLE_MODE = 0o755;

const createHandshake = async (tmp: string) => {
	const fifo = join(tmp, "response");
	const mkfifo = Bun.spawn(["mkfifo", fifo], { stderr: "pipe", stdout: "pipe" });
	expect(await mkfifo.exited).toBe(EXIT_CODES.SUCCESS);
	const script = join(tmp, "hook.sh");
	// A response from the first-line callback is required for the hook to finish.
	// Opening both ends avoids blocking on FIFO open; read's deadline bounds a regression.
	await writeFile(
		script,
		'exec 3<> "$RESPONSE_FIFO"\necho first\nIFS= read -r -t 2 -u 3 response || exit 8\necho "$response"\n',
	);
	return { fifo, script };
};

// oxlint-disable-next-line max-lines-per-function -- This test group scopes shared fixture hooks; each individual test stays below the limit.
describe("LiveHookRunner", () => {
	let tmp = "";

	beforeEach(async () => {
		tmp = await mkdtemp(join(tmpdir(), "honeycomb-hook-test-"));
	});

	afterEach(async () => {
		await rm(tmp, { force: true, recursive: true });
	});

	test("streams output while the hook waits for a response", async () => {
		const { fifo, script } = await createHandshake(tmp);
		// oxlint-disable-next-line node/no-sync -- The synchronous streaming callback must answer the waiting FIFO immediately.
		const response = openSync(fifo, "r+");
		try {
			const seen: string[] = [];
			await new LiveHookRunner().runInline(script, {
				cwd: tmp,
				env: { RESPONSE_FIFO: fifo },
				onLine: (stream, line) => {
					seen.push(`${stream}:${line}`);
					if (line === "first") {
						// oxlint-disable-next-line node/no-sync -- Reply inside the synchronous line callback to unblock the child.
						writeSync(response, "second\n");
					}
				},
			});
			expect(seen).toEqual(["stdout:first", "stdout:second"]);
		} finally {
			// oxlint-disable-next-line node/no-sync -- Close the descriptor acquired for the synchronous FIFO handshake.
			closeSync(response);
		}
	});

	test("throws HookError with exit code and slot path on failure", async () => {
		const script = join(tmp, "hook.sh");
		await writeFile(script, "echo bad >&2\nexit 7\n");
		await chmod(script, EXECUTABLE_MODE);
		const runner = new LiveHookRunner();

		try {
			await runner.runInline(script, { cwd: tmp, env: {}, onLine: () => {} });
			throw new Error("expected hook to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HookError);
			expect((error as HookError).hookExitCode).toBe(HOOK_FAILURE_CODE);
			expect((error as HookError).slotPath).toBe(tmp);
		}
	});
});

describe("LiveGitRunner", () => {
	test("runs git --version", async () => {
		const git = new LiveGitRunner();
		const result = await git.run(["--version"]);
		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(result.stdout).toContain("git version");
	});

	test("runs git even when the process cwd was removed", async () => {
		const directory = await mkdtemp(join(tmpdir(), "honeycomb-git-cwd-test-"));
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
				{ stderr: "pipe", stdout: "pipe" },
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
			await rm(directory, { force: true, recursive: true });
		}
	});
});

describe("LiveCommandRunner", () => {
	test("runs a command from a neutral cwd when the process cwd was removed", async () => {
		const directory = await mkdtemp(join(tmpdir(), "honeycomb-multiplexer-cwd-test-"));
		const runner = new URL("../../src/integrations/tmux.ts", import.meta.url).href;
		try {
			const child = Bun.spawn(
				[
					"bun",
					"-e",
					`
    import { mkdirSync, rmSync } from "node:fs";
    import { LiveCommandRunner } from ${JSON.stringify(runner)};
    const doomed = ${JSON.stringify(join(directory, "deleted-worktree"))};
    mkdirSync(doomed);
    process.chdir(doomed);
    rmSync(doomed, { recursive: true });
    const result = await new LiveCommandRunner().run("pwd", []);
    process.stdout.write(result.stdout);
   `,
				],
				{ stderr: "pipe", stdout: "pipe" },
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect({ exitCode, stderr, stdout }).toEqual({
				exitCode: 0,
				stderr: "",
				stdout: "/\n",
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});
});
