// eslint-disable-next-line import/no-nodejs-modules -- Disposable native Git fixture.
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
import { createLiveDependencies } from "../../src/live.ts";
import { defaultProjectConfig } from "../../src/config.ts";
import { hookSection } from "../../src/templates.ts";
import { installTrackerHooks } from "../../src/tracker-hooks.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary fixture root.
import { tmpdir } from "node:os";

const success = 0;
const policyFailure = 7;
const mode = 0o755;

// eslint-disable-next-line max-statements -- Verify shared hook paths, application policy and checkout isolation.
test("declared hooks preserve application policy and tracker checkout isolation", async () => {
	const root = await mkdtemp(join(tmpdir(), "beeswax tracker "));
	const io = createLiveDependencies();
	const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
	io.exec = async (argv, cwd) => {
		const child = Bun.spawn([...argv], { cwd, env: environment, stdout: "pipe", stderr: "pipe" });
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { exitCode, stdout, stderr };
	};
	io.command = async (argv, cwd) => {
		const result = await io.exec(argv, cwd);
		if (result.exitCode !== success) {
			throw new Error(result.stderr);
		}
		return result.stdout.trim();
	};
	const tracker = join(root, "tracker");
	try {
		await io.command(["git", "init", "--initial-branch=main"], root);
		const paths = {
			pre_commit: "app/pre-commit",
			pre_merge_commit: "app/pre-merge-commit",
		};
		const hook = `#!/bin/sh\n${hookSection}\nprintf '%s\\n' "$1" >> app.log\nexit 7\n`;
		await Promise.all(
			Object.values(paths).map(async (path) => {
				await io.write(join(root, path), hook);
				await chmod(join(root, path), mode);
			}),
		);
		await io.write(join(root, "app/commit-msg"), "echo application message policy\n");
		await io.command(["git", "add", "app"], root);
		await io.command(
			[
				"git",
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.test",
				"commit",
				"-m",
				"hooks",
			],
			root,
		);
		await io.command(["git", "config", "--local", "core.hooksPath", "app"], root);
		await io.command(["git", "worktree", "add", "-b", "tracker/state", tracker], root);
		const executable = join(root, "installed beeswax");
		await io.write(executable, '#!/bin/sh\nexit "$VALIDATION_EXIT"\n');
		await chmod(executable, mode);
		const config = { ...defaultProjectConfig("none"), hooks: paths };
		const options = {
			repository: root,
			database: join(tracker, ".beads/beads.db"),
			executable,
			config,
		};
		await installTrackerHooks(options, io);
		await installTrackerHooks(options, io);
		const selections = await Promise.all(
			[root, tracker].map((checkout) =>
				io.command(["git", "config", "--get", "core.hooksPath"], checkout),
			),
		);
		expect(selections).toEqual(["app", "app"]);
		expect(await io.command(["git", "status", "--porcelain"], tracker)).toBe("");
		expect(await io.read(join(tracker, paths.pre_commit))).toBe(hook);
		expect(await io.read(join(tracker, "app/commit-msg"))).toBe(
			"echo application message policy\n",
		);

		const run = async (name: string, validation: string) => {
			const child = Bun.spawn(["git", "hook", "run", name, "--", "message with spaces"], {
				cwd: tracker,
				env: { ...process.env, VALIDATION_EXIT: validation },
				stdout: "pipe",
				stderr: "pipe",
			});
			return await child.exited;
		};
		expect(await run("pre-commit", "0")).toBe(policyFailure);
		expect(await io.read(join(tracker, "app.log"))).toBe("message with spaces\n");
		expect(await run("pre-merge-commit", "7")).toBe(policyFailure);
		expect(await io.read(join(tracker, "app.log"))).toBe("message with spaces\n");

		expect(await io.exists(join(tracker, ".hive/beeswax/config.toml"))).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
