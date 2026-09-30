import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dispatch, EXIT_CODES, PushRejectedError, UsageError } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	testDeps,
	writeConfig,
	useOriginFixture,
	commitFile,
	commitOnRemoteDefault,
	run,
	runRaw,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb finish", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-finish-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("finish disabled blocks before integration with JSON payload", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, "[project.finish]\nenabled = false\n");
		await dispatch("add", ["--cwd", root, "--branch", "feature/disabled-finish", "--json"], deps);
		const worktreePath = `${root}__feature--disabled-finish`;
		await commitFile({
			repo: worktreePath,
			path: "disabled.txt",
			content: "disabled\n",
			message: "disabled work",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "blocked",
			message: expect.stringContaining("finish is disabled"),
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
	});

	test("refuses finish from canonical root", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");

		const result = await dispatch("finish", ["--cwd", root, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "canonical_root",
		});
	});

	test("refuses dirty source worktree", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/dirty-finish", "--json"], deps);
		const worktreePath = `${root}__feature--dirty-finish`;
		writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_worktree",
		});
	});

	test("enforces target freshness before integration", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/stale-target", "--json"], deps);
		const worktreePath = `${root}__feature--stale-target`;
		await commitFile({
			repo: worktreePath,
			path: "source.txt",
			content: "source\n",
			message: "source work",
		});
		await commitOnRemoteDefault({
			remote,
			path: "remote-fresh.txt",
			content: "fresh\n",
			message: "fresh remote",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "target_not_fresh",
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
	});

	test("ff_only moves the canonical default branch to the source branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/finish", "--json"], deps);
		const worktreePath = `${root}__feature--finish`;
		await commitFile({
			repo: worktreePath,
			path: "finished.txt",
			content: "finished\n",
			message: "finished work",
		});
		const sourceHead = (await run(["git", "-C", worktreePath, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			root,
			worktree_path: worktreePath,
			source_branch: "feature/finish",
			target_branch: "main",
			strategy: "ff_only",
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(sourceHead);
		expect(readFileSync(join(root, "finished.txt"), "utf8")).toBe("finished\n");
	});

	test("non-json finish prints a one-line summary to stderr", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/human-finish", "--json"], deps);
		const worktreePath = `${root}__feature--human-finish`;
		await commitFile({
			repo: worktreePath,
			path: "human.txt",
			content: "human\n",
			message: "human work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(result.stdout).toBeUndefined();
		expect(result.stderr).toBe("honeycomb: finished feature/human-finish into main\n");
	});

	test("pushes target branch after successful finish when enabled", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, "[project.finish]\npush = true\n");
		await dispatch("add", ["--cwd", root, "--branch", "feature/push-finish", "--json"], deps);
		const worktreePath = `${root}__feature--push-finish`;
		await commitFile({
			repo: worktreePath,
			path: "pushed.txt",
			content: "pushed\n",
			message: "pushed work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ cleanup_actions: ["push"] });
		expect((await run(["git", "-C", remote, "show", "main:pushed.txt"])).stdout).toBe("pushed\n");
	});

	test("push rejection blocks configured cleanup and preserves source worktree and branch", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			"[project.finish]\npush = true\nremove_worktree = true\ndelete_branch = true\n",
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/push-reject", "--json"], deps);
		const worktreePath = `${root}__feature--push-reject`;
		await commitFile({
			repo: worktreePath,
			path: "reject.txt",
			content: "source\n",
			message: "source work",
		});
		writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n");
		chmodSync(join(remote, "hooks", "pre-receive"), 0o755);

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(result.failure).toBeInstanceOf(PushRejectedError);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			ok: false,
			kind: "blocked",
			reason: "push_rejected",
			integrated: true,
			cleanup_actions: [],
		});
		expect(existsSync(worktreePath)).toBe(true);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/push-reject"]))
				.exitCode,
		).toBe(0);
	});

	test("removes a non-pooled source worktree after finish when cleanup is enabled", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, "[project.finish]\nremove_worktree = true\n");
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/remove-after-finish", "--json"],
			deps,
		);
		const worktreePath = `${root}__feature--remove-after-finish`;
		await commitFile({
			repo: worktreePath,
			path: "remove.txt",
			content: "remove\n",
			message: "remove work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			cleanup_actions: ["remove_worktree"],
		});
		expect(existsSync(worktreePath)).toBe(false);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/remove-after-finish",
				])
			).exitCode,
		).toBe(0);
	});

	test("recycles a pooled local-only source worktree after finish while preserving ignored files", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			"mkdir -p node_modules; touch node_modules/.keep",
			1,
			"[project.finish]\nremove_worktree = true\n",
		);
		await dispatch("ensure", ["--cwd", root], testDeps());
		const excludePath = (
			await run(["git", "-C", `${root}__feat1`, "rev-parse", "--git-path", "info/exclude"])
		).stdout.trim();
		writeFileSync(resolve(`${root}__feat1`, excludePath), "node_modules/\n");
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pooled-finish", "--slot", `${root}__feat1`, "--json"],
			testDeps(),
		);
		await commitFile({
			repo: `${root}__feat1`,
			path: "pooled.txt",
			content: "pooled\n",
			message: "pooled work",
		});

		const result = await dispatch("finish", ["--cwd", `${root}__feat1`, "--json"], testDeps());

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			cleanup_actions: ["recycle_worktree"],
		});
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(existsSync(join(`${root}__feat1`, "node_modules", ".keep"))).toBe(true);
	});

	test("deletes source branch after squash finish when configured", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'[project.finish]\nstrategy = "squash"\nremove_worktree = true\ndelete_branch = true\n',
		);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/delete-after-squash", "--json"],
			deps,
		);
		const worktreePath = `${root}__feature--delete-after-squash`;
		await commitFile({
			repo: worktreePath,
			path: "squash-delete.txt",
			content: "delete\n",
			message: "delete work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			cleanup_actions: ["remove_worktree", "delete_branch"],
		});
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/delete-after-squash",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("configured finish cleanup enables push, removal, and branch deletion", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			"[project.finish]\npush = true\nremove_worktree = true\ndelete_branch = true\n",
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/policy-cleanup", "--json"], deps);
		const worktreePath = `${root}__feature--policy-cleanup`;
		await commitFile({
			repo: worktreePath,
			path: "policy-cleanup.txt",
			content: "policy\n",
			message: "policy cleanup",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			cleanup_actions: ["push", "remove_worktree", "delete_branch"],
		});
		expect((await run(["git", "-C", remote, "show", "main:policy-cleanup.txt"])).stdout).toBe(
			"policy\n",
		);
		expect(existsSync(worktreePath)).toBe(false);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/policy-cleanup",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("cleanup refusal returns structured payload without integration or force deletion", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, "[project.finish]\ndelete_branch = true\n");
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/delete-without-remove", "--json"],
			deps,
		);
		const worktreePath = `${root}__feature--delete-without-remove`;
		await commitFile({
			repo: worktreePath,
			path: "cleanup-refusal.txt",
			content: "cleanup\n",
			message: "cleanup work",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
		expect(
			(await runRaw(["git", "-C", root, "show", "HEAD:cleanup-refusal.txt"])).exitCode,
		).not.toBe(0);
		expect(existsSync(worktreePath)).toBe(true);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/delete-without-remove",
				])
			).exitCode,
		).toBe(0);
	});

	test("squash integrates source changes as one deterministic target commit", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.finish]\nstrategy = "squash"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/squash-finish", "--json"], deps);
		const worktreePath = `${root}__feature--squash-finish`;
		await commitFile({ repo: worktreePath, path: "one.txt", content: "one\n", message: "one" });
		await commitFile({ repo: worktreePath, path: "two.txt", content: "two\n", message: "two" });
		const beforeHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "squash" });
		expect((await run(["git", "-C", root, "log", "-1", "--format=%s"])).stdout.trim()).toBe(
			"chore: integrate worktree",
		);
		expect((await run(["git", "-C", root, "log", "-1", "--format=%B"])).stdout).toContain(
			"Source branch:\nfeature/squash-finish",
		);
		expect(
			(await run(["git", "-C", root, "rev-list", "--count", `${beforeHead}..HEAD`])).stdout.trim(),
		).toBe("1");
		expect(readFileSync(join(root, "one.txt"), "utf8")).toBe("one\n");
		expect(readFileSync(join(root, "two.txt"), "utf8")).toBe("two\n");
	});

	test("merge_commit integrates source with an explicit merge commit", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			'[project.finish]\nstrategy = "merge_commit"\n',
		);
		await dispatch("add", ["--cwd", root, "--branch", "feature/merge-finish", "--json"], deps);
		const worktreePath = `${root}__feature--merge-finish`;
		await commitFile({
			repo: worktreePath,
			path: "merge-source.txt",
			content: "source\n",
			message: "source work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "merge_commit" });
		expect((await run(["git", "-C", root, "log", "-1", "--format=%s"])).stdout.trim()).toBe(
			"chore: merge worktree",
		);
		expect((await run(["git", "-C", root, "log", "-1", "--format=%B"])).stdout).toContain(
			"Source branch:\nfeature/merge-finish",
		);
		expect(
			(await run(["git", "-C", root, "rev-list", "--parents", "-n", "1", "HEAD"])).stdout
				.trim()
				.split(" "),
		).toHaveLength(3);
		expect(readFileSync(join(root, "merge-source.txt"), "utf8")).toBe("source\n");
	});

	test("rebase_ff rebases source onto target then fast-forwards target", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.finish]\nstrategy = "rebase_ff"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/rebase-finish", "--json"], deps);
		const worktreePath = `${root}__feature--rebase-finish`;
		await commitFile({
			repo: worktreePath,
			path: "source-rebased.txt",
			content: "source\n",
			message: "source work",
		});
		await commitFile({
			repo: root,
			path: "target-base.txt",
			content: "target\n",
			message: "target work",
		});
		const targetHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "rebase_ff" });
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(
			(
				await run(["git", "-C", root, "rev-parse", "refs/heads/feature/rebase-finish"])
			).stdout.trim(),
		);
		expect(
			(await run(["git", "-C", root, "rev-list", "--parents", "-n", "1", "HEAD"])).stdout
				.trim()
				.split(" "),
		).toHaveLength(2);
		expect((await run(["git", "-C", root, "rev-parse", "HEAD~1"])).stdout.trim()).toBe(targetHead);
		expect(readFileSync(join(root, "source-rebased.txt"), "utf8")).toBe("source\n");
	});

	test("non-ff strategy conflict emits structured refusal", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.finish]\nstrategy = "squash"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/squash-conflict", "--json"], deps);
		const worktreePath = `${root}__feature--squash-conflict`;
		await commitFile({
			repo: worktreePath,
			path: "README.md",
			content: "source\n",
			message: "source change",
		});
		await commitFile({
			repo: root,
			path: "README.md",
			content: "target\n",
			message: "target change",
		});
		const targetHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();
		const sourceHead = (await run(["git", "-C", worktreePath, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "conflict",
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(targetHead);
		expect(
			(
				await run(["git", "-C", root, "rev-parse", "refs/heads/feature/squash-conflict"])
			).stdout.trim(),
		).toBe(sourceHead);
		expect(existsSync(worktreePath)).toBe(true);
	});

	test("finish rejects CLI policy overrides before fresh_canonical mutates target", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/cli-policy-override", "--json"],
			deps,
		);
		const worktreePath = `${root}__feature--cli-policy-override`;
		await commitFile({
			repo: worktreePath,
			path: "cli-policy-override.txt",
			content: "source\n",
			message: "source work",
		});
		await commitOnRemoteDefault({
			remote,
			path: "remote-before-usage.txt",
			content: "remote\n",
			message: "remote work",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const { failure } = await dispatch(
			"finish",
			["--cwd", worktreePath, "--json", "--strategy", "ff_only"],
			deps,
		);
		expect(failure).toBeInstanceOf(UsageError);
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
	});

	test("configured finish strategy is not overridden by CLI", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.finish]\nstrategy = "squash"\n');
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/configured-strategy", "--json"],
			deps,
		);
		const worktreePath = `${root}__feature--configured-strategy`;
		await commitFile({
			repo: worktreePath,
			path: "configured.txt",
			content: "configured\n",
			message: "configured work",
		});

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "squash" });
		expect((await run(["git", "-C", root, "log", "-1", "--format=%s"])).stdout.trim()).toBe(
			"chore: integrate worktree",
		);
	});

	test("fresh_canonical conflict refuses without first fast-forwarding target", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/fresh-conflict", "--json"], deps);
		const worktreePath = `${root}__feature--fresh-conflict`;
		await commitFile({
			repo: worktreePath,
			path: "source.txt",
			content: "source\n",
			message: "source work",
		});
		await commitOnRemoteDefault({
			remote,
			path: "remote-fresh.txt",
			content: "fresh\n",
			message: "fresh remote",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "conflict",
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
		expect((await runRaw(["git", "-C", root, "show", "HEAD:remote-fresh.txt"])).exitCode).not.toBe(
			0,
		);
	});

	test("non-fast-forward ff_only refuses without target modification", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/divergent-finish", "--json"], deps);
		const worktreePath = `${root}__feature--divergent-finish`;
		await commitFile({
			repo: worktreePath,
			path: "source-only.txt",
			content: "source\n",
			message: "source work",
		});
		await commitFile({
			repo: root,
			path: "target-only.txt",
			content: "target\n",
			message: "target work",
		});
		const targetHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "conflict",
		});
		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(targetHead);
	});
});
