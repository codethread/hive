import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	testDeps,
	writeConfig,
	initRepoWithOrigin,
	createRemoteBranch,
	commitFile,
	commitOnRemoteDefault,
	run,
	runRaw,
} from "./support.ts";

describe("pooled honeycomb remove", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-recycle-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("safe pooled remove resets slot to placeholder with removed false", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/safe");
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/safe", "--json"], testDeps());
		await run([
			"git",
			"-C",
			`${root}__feat1`,
			"branch",
			"--set-upstream-to",
			"origin/feature/safe",
			"feature/safe",
		]);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/safe", "--json"],
			testDeps(),
		);

		expect(existsSync(`${root}__feat1`)).toBe(true);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/safe"]))
				.exitCode,
		).not.toBe(0);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			worktree_path: `${root}__feat1`,
			removed: false,
			session: {
				name: "repo__feat1",
				path: `${root}__feat1`,
			},
		});
	});

	test("recycles a clean squash-integrated slot and deletes its branch", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/squash", "--json"], testDeps());
		await commitFile({
			repo: `${root}__feat1`,
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

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/squash", "--integrated-into", "origin/main", "--json"],
			testDeps(),
		);

		expect(result.exitCode).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/squash"]))
				.exitCode,
		).not.toBe(0);
	});

	test("keep-branch recycles a clean unmerged slot and preserves its branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/squash-merged", "--json"],
			testDeps(),
		);
		writeFileSync(join(`${root}__feat1`, "work.txt"), "work\n");
		await run(["git", "-C", `${root}__feat1`, "add", "work.txt"]);
		await run(["git", "-C", `${root}__feat1`, "commit", "-m", "work"]);

		const result = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/squash-merged", "--keep-branch", "--json"],
			testDeps(),
		);

		expect(result.exitCode).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
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

	test("safe preflight blocks dirty slots and leaves branch untouched", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/dirty", "--json"], testDeps());
		writeFileSync(join(`${root}__feat1`, "dirty.txt"), "dirty\n");

		await expect(
			dispatch("remove", ["--cwd", root, "--self", `${root}__feat1`, "--keep-branch"], testDeps()),
		).rejects.toThrow("uncommitted changes");

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/dirty");
		expect(existsSync(join(`${root}__feat1`, "dirty.txt"))).toBe(true);
	});

	test("forced pooled remove discards tracked and untracked dirt but preserves gitignored node_modules", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".gitignore"), "node_modules/\n");
		await run(["git", "-C", root, "add", ".gitignore"]);
		await run(["git", "-C", root, "commit", "-m", "ignore modules"]);
		await run(["git", "-C", root, "push", "origin", "main"]);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/force-recycle", "--json"],
			testDeps(),
		);
		writeFileSync(join(`${root}__feat1`, "tracked.txt"), "tracked\n");
		await run(["git", "-C", `${root}__feat1`, "add", "tracked.txt"]);
		await run(["git", "-C", `${root}__feat1`, "commit", "-m", "local unmerged"]);
		writeFileSync(join(`${root}__feat1`, "untracked.txt"), "untracked\n");
		mkdirSync(join(`${root}__feat1`, "node_modules"));
		writeFileSync(join(`${root}__feat1`, "node_modules", "keep.txt"), "keep\n");

		await dispatch("remove", ["--cwd", root, "--self", `${root}__feat1`, "--force"], testDeps());

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(existsSync(join(`${root}__feat1`, "tracked.txt"))).toBe(false);
		expect(existsSync(join(`${root}__feat1`, "untracked.txt"))).toBe(false);
		expect(existsSync(join(`${root}__feat1`, "node_modules", "keep.txt"))).toBe(true);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/force-recycle",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("missing or unmerged upstream blocks safe pooled remove", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/upstream-blocked");
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/upstream-blocked", "--json"],
			testDeps(),
		);
		await expect(
			dispatch("remove", ["--cwd", root, "--self", `${root}__feat1`], testDeps()),
		).rejects.toThrow("no upstream");
		await run([
			"git",
			"-C",
			`${root}__feat1`,
			"branch",
			"--set-upstream-to",
			"origin/feature/upstream-blocked",
			"feature/upstream-blocked",
		]);
		writeFileSync(join(`${root}__feat1`, "ahead.txt"), "ahead\n");
		await run(["git", "-C", `${root}__feat1`, "add", "ahead.txt"]);
		await run(["git", "-C", `${root}__feat1`, "commit", "-m", "ahead"]);

		await expect(
			dispatch("remove", ["--cwd", root, "--self", `${root}__feat1`], testDeps()),
		).rejects.toThrow("not merged");
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/upstream-blocked");
	});
});
