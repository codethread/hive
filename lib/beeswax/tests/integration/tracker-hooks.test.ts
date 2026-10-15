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
const absent = 1;
const policyFailure = 7;
const mode = 0o755;

// eslint-disable-next-line max-statements -- Verify worktree configuration and generated shell delegation together.
test("tracker adapter preserves application policy, hook arguments and checkout isolation", async () => {
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
		await io.command(
			[
				"git",
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.test",
				"commit",
				"--allow-empty",
				"-m",
				"initial",
			],
			root,
		);
		await io.command(["git", "worktree", "add", "-b", "tracker/state", tracker], root);
		const executable = join(root, "installed beeswax");
		await io.write(
			executable,
			[
				"#!/bin/sh",
				'case "$2" in',
				'validate) exit "$VALIDATION_EXIT";;',
				'is-tracker-snapshot) exit "$SNAPSHOT_STATUS";;',
				"esac",
				"exit 9",
				"",
			].join("\n"),
		);
		await chmod(executable, mode);
		const delegates = {
			pre_commit: "app/pre-commit",
			pre_merge_commit: "app/pre-merge-commit",
			commit_msg: "app/commit-msg",
		};
		await Promise.all(
			Object.values(delegates).map((path) =>
				io.write(join(tracker, path), 'printf "%s\\n" "$1" >> app.log\nexit 7\n'),
			),
		);
		await io.write(
			join(tracker, delegates.pre_commit),
			`${hookSection}\n${await io.read(join(tracker, delegates.pre_commit))}`,
		);
		const config = { ...defaultProjectConfig("none"), tracker: { hooks: delegates } };
		await installTrackerHooks(
			{ repository: root, database: join(tracker, ".beads/beads.db"), executable, config },
			io,
		);
		const directory = await io.command(["git", "config", "--get", "core.hooksPath"], tracker);
		const mainConfiguration = await io.exec(["git", "config", "--get", "core.hooksPath"], root);
		expect(mainConfiguration.exitCode).toBe(absent);
		const run = async (name: string, snapshot: string, validation: string) => {
			const child = Bun.spawn(["sh", join(directory, name), "message with spaces"], {
				cwd: tracker,
				env: { ...process.env, SNAPSHOT_STATUS: snapshot, VALIDATION_EXIT: validation },
				stdout: "pipe",
				stderr: "pipe",
			});
			return await child.exited;
		};
		expect(await run("pre-commit", "0", "0")).toBe(success);
		expect(await io.exists(join(tracker, "app.log"))).toBe(false);
		expect(await run("pre-merge-commit", "0", "7")).toBe(policyFailure);
		expect(await run("pre-commit", "1", "0")).toBe(policyFailure);
		expect(await run("commit-msg", "0", "0")).toBe(policyFailure);
		expect(await io.read(join(tracker, "app.log"))).toBe(
			"message with spaces\nmessage with spaces\n",
		);
		expect(await io.exists(join(tracker, ".hive/beeswax/config.toml"))).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
