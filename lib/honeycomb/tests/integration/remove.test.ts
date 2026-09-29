import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, EXIT_CODES } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	writeConfig,
	useOriginFixture,
	commitFile,
	commitOnRemoteDefault,
	run,
	runRaw,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb non-pool remove", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-remove-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("removes a non-pool worktree and branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/remove", "--json"], deps);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/remove", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		const plan = JSON.parse(result.stdout ?? "{}");
		expect(existsSync(`${root}__feature--remove`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/remove"]))
				.exitCode,
		).not.toBe(0);
		expect(plan).toMatchObject({
			kind: "ready",
			worktree_path: `${root}__feature--remove`,
			removed: true,
			session: {
				name: "repo__feature--remove",
				path: `${root}__feature--remove`,
			},
		});
	});

	test("removes the worktree containing --cwd with boolean --self", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/self", "--json"], deps);
		const worktreePath = `${root}__feature--self`;
		const nested = join(worktreePath, "nested");
		mkdirSync(nested, { recursive: true });

		const result = await dispatch("remove", ["--cwd", nested, "--self", "--json"], deps);

		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			worktree_path: worktreePath,
			removed: true,
		});
		expect(existsSync(worktreePath)).toBe(false);
	});

	test("non-json remove prints a one-line summary to stderr", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/human-remove", "--json"], deps);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/human-remove"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBeUndefined();
		expect(result.stderr).toBe(`honeycomb: removed worktree at ${root}__feature--human-remove\n`);
	});

	test("removes non-pool branches whose encoded paths resemble pool slots", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feat1", "--json"], deps);

		await dispatch("remove", ["--cwd", root, "--branch", "feat1", "--json"], deps);

		expect(existsSync(`${root}__feat1`)).toBe(false);
	});

	test("unmerged branch fails without --force and succeeds with --force", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/unmerged", "--json"], deps);
		writeFileSync(join(`${root}__feature--unmerged`, "unmerged.txt"), "work\n");
		await run(["git", "-C", `${root}__feature--unmerged`, "add", "unmerged.txt"]);
		await run(["git", "-C", `${root}__feature--unmerged`, "commit", "-m", "unmerged"]);

		const blocked = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/unmerged", "--json"],
			deps,
		);
		expect(blocked.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "unmerged_branch",
			branch: "feature/unmerged",
			worktree_path: `${root}__feature--unmerged`,
		});
		expect(existsSync(`${root}__feature--unmerged`)).toBe(true);

		await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/unmerged", "--force", "--json"],
			deps,
		);
		expect(existsSync(`${root}__feature--unmerged`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/unmerged"]))
				.exitCode,
		).not.toBe(0);
	});

	test("removes a clean squash-integrated branch after fetching its claimed target", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/squash", "--json"], deps);
		await commitFile({
			repo: `${root}__feature--squash`,
			path: "work.txt",
			content: "work\n",
			message: "feature work",
		});
		await commitOnRemoteDefault({
			remote,
			path: "work.txt",
			content: "work\n",
			message: "squash feature",
		});
		await commitOnRemoteDefault({
			remote,
			path: "later.txt",
			content: "later\n",
			message: "later work",
		});

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/squash", "--integrated-into", "origin/main", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(existsSync(`${root}__feature--squash`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/squash"]))
				.exitCode,
		).not.toBe(0);
	});

	test("refuses squash-aware removal when the target lacks source content", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/not-integrated", "--json"], deps);
		await commitFile({
			repo: `${root}__feature--not-integrated`,
			path: "work.txt",
			content: "work\n",
			message: "feature work",
		});

		const result = await dispatch(
			"remove",
			[
				"--cwd",
				root,
				"--branch",
				"feature/not-integrated",
				"--integrated-into",
				"origin/main",
				"--json",
			],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "unmerged_branch",
			branch: "feature/not-integrated",
			worktree_path: `${root}__feature--not-integrated`,
		});
		expect(existsSync(`${root}__feature--not-integrated`)).toBe(true);
	});

	test("refuses squash-aware removal of a dirty worktree", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/dirty-squash", "--json"], deps);
		await commitFile({
			repo: `${root}__feature--dirty-squash`,
			path: "work.txt",
			content: "work\n",
			message: "feature work",
		});
		await commitOnRemoteDefault({
			remote,
			path: "work.txt",
			content: "work\n",
			message: "squash feature",
		});
		writeFileSync(join(`${root}__feature--dirty-squash`, "uncommitted.txt"), "keep\n");

		const result = await dispatch(
			"remove",
			[
				"--cwd",
				root,
				"--branch",
				"feature/dirty-squash",
				"--integrated-into",
				"origin/main",
				"--json",
			],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_worktree",
			branch: "feature/dirty-squash",
		});
		expect(existsSync(join(`${root}__feature--dirty-squash`, "uncommitted.txt"))).toBe(true);
	});

	test("keep-branch removes a clean unmerged worktree and preserves its branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/squash-merged", "--json"], deps);
		writeFileSync(join(`${root}__feature--squash-merged`, "work.txt"), "work\n");
		await run(["git", "-C", `${root}__feature--squash-merged`, "add", "work.txt"]);
		await run(["git", "-C", `${root}__feature--squash-merged`, "commit", "-m", "work"]);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/squash-merged", "--keep-branch", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(existsSync(`${root}__feature--squash-merged`)).toBe(false);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/squash-merged",
				])
			).exitCode,
		).toBe(0);
	});

	test("machine json remove reports blocked outcomes with unsafe exit codes", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/unmerged-json", "--json"], deps);
		writeFileSync(join(`${root}__feature--unmerged-json`, "unmerged.txt"), "work\n");
		await run(["git", "-C", `${root}__feature--unmerged-json`, "add", "unmerged.txt"]);
		await run(["git", "-C", `${root}__feature--unmerged-json`, "commit", "-m", "unmerged"]);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/unmerged-json", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "unmerged_branch",
			branch: "feature/unmerged-json",
			worktree_path: `${root}__feature--unmerged-json`,
		});
		expect(existsSync(`${root}__feature--unmerged-json`)).toBe(true);
	});

	test("refuses canonical root and requires exactly one target selector", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");

		const canonicalRoot = await dispatch("remove", ["--cwd", root, "--self", "--json"], deps);
		expect(canonicalRoot.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(canonicalRoot.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "canonical_root",
		});
		await expect(dispatch("remove", ["--cwd", root, "--json"], deps)).rejects.toThrow(
			"provide exactly one of --branch or --self",
		);
	});
});
