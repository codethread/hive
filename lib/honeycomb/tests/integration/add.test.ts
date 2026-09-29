import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { dispatch, EXIT_CODES } from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	deps,
	testDeps,
	writeConfig,
	useOriginFixture,
	createRemoteBranch,
	commitOnRemoteDefault,
	run,
	runRaw,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb non-pool add", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-add-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("adds a new branch, runs setup, and writes ready JSON to stdout", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, `echo "$WK_ROOT" > "$WK_CREATED/hook-sentinel"`);

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/new", "--json"],
			testDeps(),
		);

		expect(result.exitCode).toBe(0);
		const worktreePath = `${root}__feature--new`;
		expect(existsSync(join(worktreePath, ".git"))).toBe(true);
		const plan = JSON.parse(result.stdout ?? "{}");
		expect(plan).toMatchObject({
			kind: "ready",
			worktree_path: worktreePath,
			branch: "feature/new",
			root,
			title: "feature/new",
			post_create_script_path: null,
			created_new_branch: true,
			session: {
				name: basename(worktreePath).replaceAll(".", "_"),
				path: worktreePath,
			},
		});
		expect(readFileSync(join(worktreePath, "hook-sentinel"), "utf8")).toBe(`${root}\n`);
	});

	test("--json keeps stdout a single payload while setup prints output", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo setup-stdout\necho setup-stderr >&2");

		const proc = Bun.spawn(
			[
				"bun",
				resolve(import.meta.dirname, "../../bin/honeycomb.ts"),
				"add",
				"--cwd",
				root,
				"--branch",
				"feature/noisy",
				"--json",
			],
			{ env: process.env, stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ kind: "ready", branch: "feature/noisy" });
		expect(stderr).toContain("setup-stdout");
		expect(stderr).toContain("setup-stderr");
	});

	test("setup failure rolls back the new worktree and branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo failing >&2\nexit 7");

		await expect(
			dispatch("add", ["--cwd", root, "--branch", "feature/setup-fail", "--json"], testDeps()),
		).rejects.toThrow("hook failed");

		expect(existsSync(`${root}__feature--setup-fail`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/setup-fail"]))
				.exitCode,
		).not.toBe(0);
	});

	test("setup failure restores an existing branch tip", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		await run(["git", "-C", root, "branch", "feature/setup-restore"]);
		const originalHead = (
			await run(["git", "-C", root, "rev-parse", "refs/heads/feature/setup-restore"])
		).stdout.trim();
		writeConfig(tmp, root, "exit 7");

		await expect(
			dispatch("add", ["--cwd", root, "--branch", "feature/setup-restore", "--json"], testDeps()),
		).rejects.toThrow("hook failed");

		expect(existsSync(`${root}__feature--setup-restore`)).toBe(false);
		expect(
			(
				await run(["git", "-C", root, "rev-parse", "refs/heads/feature/setup-restore"])
			).stdout.trim(),
		).toBe(originalHead);
	});

	test("creates nested worktrees under the canonical root without dirtying it", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const configHome = join(tmp, "config-nested");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`worktree_location = "sibling"\n\n[[project]]\nroot = "${root}"\nworktree_location = "nested"\n`,
		);
		setTestEnv("XDG_CONFIG_HOME", configHome);
		const worktreePath = join(root, ".worktrees", "feature--nested");

		const pathResult = await dispatch("path", ["--cwd", root, "--branch", "feature/nested"], deps);
		const addResult = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/nested", "--json"],
			deps,
		);

		expect(pathResult.stdout).toBe(`${worktreePath}\n`);
		expect(JSON.parse(addResult.stdout ?? "{}")).toMatchObject({
			worktree_path: worktreePath,
			session: { name: "repo__feature--nested", path: worktreePath },
		});
		expect(existsSync(join(worktreePath, ".git"))).toBe(true);
		expect((await run(["git", "-C", root, "status", "--porcelain"])).stdout).toBe("");
	});

	test("keeps legacy and manual worktrees discoverable after changing location", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const configHome = join(tmp, "config-mixed-layout");
		mkdirSync(configHome, { recursive: true });
		setTestEnv("XDG_CONFIG_HOME", configHome);
		writeFileSync(join(configHome, "honeycomb.toml"), 'worktree_location = "sibling"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/legacy", "--json"], deps);
		const legacyPath = `${root}__feature--legacy`;
		let manualPath = join(tmp, "manual-worktree");
		await run(["git", "-C", root, "worktree", "add", "-b", "feature/manual", manualPath]);
		manualPath = realpathSync(manualPath);

		writeFileSync(join(configHome, "honeycomb.toml"), 'worktree_location = "nested"\n');
		const nestedPath = join(root, ".worktrees", "feature--new");
		await dispatch("add", ["--cwd", root, "--branch", "feature/new", "--json"], deps);

		expect(
			(await dispatch("path", ["--cwd", root, "--branch", "feature/legacy"], deps)).stdout,
		).toBe(`${legacyPath}\n`);
		expect(
			(await dispatch("path", ["--cwd", root, "--branch", "feature/manual"], deps)).stdout,
		).toBe(`${manualPath}\n`);
		const listed = JSON.parse(
			(await dispatch("list", ["--cwd", root, "--json"], deps)).stdout ?? "[]",
		);
		expect(listed.map((worktree: { path: string }) => worktree.path)).toEqual(
			expect.arrayContaining([root, legacyPath, manualPath, nestedPath]),
		);
		const duplicate = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/legacy", "--json"],
			deps,
		);
		expect(JSON.parse(duplicate.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "duplicate_branch",
			message: expect.stringContaining(legacyPath),
		});
	});

	test("uses inherited rule command for a repo without exact project config", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const configHome = join(tmp, "config-rule-command");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`[[rule]]\nroot_glob = "${realpathSync(tmp)}/**"\ncommand = '''\necho inherited > "$WK_CREATED/rule-sentinel"\n'''\n`,
		);
		setTestEnv("XDG_CONFIG_HOME", configHome);

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/rule-command", "--json"],
			testDeps(),
		);

		expect(readFileSync(join(`${root}__feature--rule-command`, "rule-sentinel"), "utf8")).toBe(
			"inherited\n",
		);
	});

	test("copies configured files before running setup", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "SECRET=setup\n");
		writeConfig(
			tmp,
			root,
			'cat .env > "$WK_CREATED/hook-read-env"',
			undefined,
			'copy = [".env"]\n',
		);

		await dispatch("add", ["--cwd", root, "--branch", "feature/copy-setup", "--json"], testDeps());
		const worktreePath = `${root}__feature--copy-setup`;

		expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("SECRET=setup\n");
		expect(readFileSync(join(worktreePath, "hook-read-env"), "utf8")).toBe("SECRET=setup\n");
	});

	test("copy setup failure during add rolls back the new worktree and branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo should-not-run", undefined, 'copy = [".env.missing"]\n');

		await expect(
			dispatch("add", ["--cwd", root, "--branch", "feature/copy-fail", "--json"], deps),
		).rejects.toThrow("copy source does not exist");

		expect(existsSync(`${root}__feature--copy-fail`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/copy-fail"]))
				.exitCode,
		).not.toBe(0);
	});

	test("copy setup failure during add restores an existing branch tip", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/restore-tip");
		await run(["git", "-C", root, "fetch", "origin"]);
		await run(["git", "-C", root, "branch", "feature/restore-tip", "main"]);
		const originalHead = (
			await run(["git", "-C", root, "rev-parse", "refs/heads/feature/restore-tip"])
		).stdout.trim();
		writeConfig(tmp, root, "echo should-not-run", undefined, 'copy = [".env.missing"]\n');

		await expect(
			dispatch("add", ["--cwd", root, "--branch", "feature/restore-tip", "--json"], deps),
		).rejects.toThrow("copy source does not exist");

		expect(existsSync(`${root}__feature--restore-tip`)).toBe(false);
		expect(
			(await run(["git", "-C", root, "rev-parse", "refs/heads/feature/restore-tip"])).stdout.trim(),
		).toBe(originalHead);
	});

	test("pre_remote_check blocks add before fetch and surfaces stderr", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await commitOnRemoteDefault({
			remote,
			path: "precheck-remote.txt",
			content: "remote\n",
			message: "remote before blocked add",
		});
		writeConfig(
			tmp,
			root,
			"echo ready",
			undefined,
			"pre_remote_check = '''\necho precheck blocked >&2\nexit 7\n'''\n",
		);

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/precheck-blocked", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(result.stderr).toContain("precheck blocked");
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "pre_remote_check_failed",
			message: expect.stringContaining("precheck blocked"),
		});
		expect(existsSync(`${root}__feature--precheck-blocked`)).toBe(false);
		expect(
			(await runRaw(["git", "-C", root, "show", "origin/main:precheck-remote.txt"])).exitCode,
		).not.toBe(0);
	});

	test.each([
		{ name: "existing local", branch: "feature/local", source: "local" },
		{ name: "existing remote-only", branch: "feature/remote", source: "remote" },
		{ name: "existing local and remote", branch: "feature/both", source: "both" },
	])("adds $name branch", async ({ branch, source }) => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		if (source !== "local") await createRemoteBranch(remote, branch);
		if (source === "local") await run(["git", "-C", root, "branch", branch]);
		if (source === "both") {
			await run(["git", "-C", root, "fetch", "origin"]);
			await run(["git", "-C", root, "branch", branch, `origin/${branch}`]);
		}
		writeConfig(tmp, root, "echo ready");

		const result = await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], deps);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout ?? "{}").worktree_path).toBe(
			`${root}__${branch.replaceAll("/", "--")}`,
		);
	});

	test("fresh_canonical preserves existing branch add behavior after policy fetch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		await run(["git", "-C", root, "branch", "feature/existing-fresh"]);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		writeFileSync(join(root, "dirty-canonical.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/existing-fresh", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			worktree_path: `${root}__feature--existing-fresh`,
			created_new_branch: false,
		});
	});

	test("warns but succeeds when local branch has diverged from remote", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/diverged");
		await run(["git", "-C", root, "fetch", "origin"]);
		await run(["git", "-C", root, "checkout", "-b", "feature/diverged", "main"]);
		writeFileSync(join(root, "local.txt"), "local\n");
		await run(["git", "-C", root, "add", "local.txt"]);
		await run(["git", "-C", root, "commit", "-m", "local"]);
		await run(["git", "-C", root, "checkout", "main"]);
		writeConfig(tmp, root, "echo ready");
		const warnings: string[] = [];
		const warnDeps = {
			...deps,
			progress: { ...deps.progress, error: (msg: string) => warnings.push(msg) },
		};

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/diverged", "--json"],
			warnDeps,
		);

		expect(result.exitCode).toBe(0);
		expect(warnings.join("\n")).toContain("couldn't fast-forward");
	});

	test("defaults new branches to origin default branch instead of current HEAD", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await run(["git", "-C", root, "checkout", "-b", "local/current"]);
		writeFileSync(join(root, "current-only.txt"), "current\n");
		await run(["git", "-C", root, "add", "current-only.txt"]);
		await run(["git", "-C", root, "commit", "-m", "current only"]);

		await dispatch("add", ["--cwd", root, "--branch", "feature/default-base", "--json"], deps);

		const missing = await Bun.spawn(
			["git", "-C", `${root}__feature--default-base`, "show", "HEAD:current-only.txt"],
			{ stdout: "pipe", stderr: "pipe" },
		).exited;
		expect(missing).not.toBe(0);
	});

	test("origin_default creates new branches from fetched origin default without mutating canonical root", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await commitOnRemoteDefault({
			remote,
			path: "remote-only.txt",
			content: "remote default\n",
			message: "remote default update",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		await dispatch("add", ["--cwd", root, "--branch", "feature/origin-default", "--json"], deps);

		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
		expect(
			(await run(["git", "-C", `${root}__feature--origin-default`, "show", "HEAD:remote-only.txt"]))
				.stdout,
		).toBe("remote default\n");
	});

	test("fresh_canonical fast-forwards clean canonical default before creating a branch", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "fresh.txt",
			content: "fresh\n",
			message: "fresh default update",
		});

		await dispatch("add", ["--cwd", root, "--branch", "feature/fresh", "--json"], deps);

		expect((await run(["git", "-C", root, "show", "HEAD:fresh.txt"])).stdout).toBe("fresh\n");
		expect(
			(await run(["git", "-C", `${root}__feature--fresh`, "show", "HEAD:fresh.txt"])).stdout,
		).toBe("fresh\n");
	});

	test("fresh_canonical blocks dirty canonical root with JSON reason", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "dirty-block.txt",
			content: "remote\n",
			message: "dirty block update",
		});
		writeFileSync(join(root, "dirty.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/dirty-block", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_canonical",
		});
		expect(existsSync(`${root}__feature--dirty-block`)).toBe(false);
	});

	test("fresh_canonical blocks wrong canonical branch with JSON reason", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "wrong-branch.txt",
			content: "remote\n",
			message: "wrong branch update",
		});
		await run(["git", "-C", root, "checkout", "-b", "other"]);

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/wrong-branch", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "wrong_canonical_branch",
		});
		expect(existsSync(`${root}__feature--wrong-branch`)).toBe(false);
	});

	test("fresh_canonical blocks non-fast-forward canonical update with JSON reason", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "non-ff-remote.txt",
			content: "remote\n",
			message: "non ff remote update",
		});
		writeFileSync(join(root, "local-main.txt"), "local\n");
		await run(["git", "-C", root, "add", "local-main.txt"]);
		await run(["git", "-C", root, "commit", "-m", "local main update"]);

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/non-ff", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "non_ff_canonical",
		});
		expect(existsSync(`${root}__feature--non-ff`)).toBe(false);
	});

	test("fresh_canonical explicit base bypasses canonical update requirement", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "base/stacked");
		writeConfig(tmp, root, "echo ready", undefined, '[project.add]\npolicy = "fresh_canonical"\n');
		writeFileSync(join(root, "dirty-canonical.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/from-explicit-base", "--base", "base/stacked", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feature--from-explicit-base`, "show", "HEAD:remote.txt"]))
				.stdout,
		).toBe("base/stacked\n");
	});

	test("uses --base for a new branch and warns when --base is ignored for existing branch", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "base/topic");
		writeConfig(tmp, root, "echo ready");
		const warnings: string[] = [];
		const warnDeps = {
			...deps,
			progress: { ...deps.progress, error: (msg: string) => warnings.push(msg) },
		};

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/from-base", "--base", "base/topic", "--json"],
			warnDeps,
		);
		const baseFile = await run([
			"git",
			"-C",
			`${root}__feature--from-base`,
			"show",
			"HEAD:remote.txt",
		]);
		expect(baseFile.stdout).toBe("base/topic\n");

		await run(["git", "-C", root, "checkout", "-b", "local/base"]);
		writeFileSync(join(root, "local-base.txt"), "local base\n");
		await run(["git", "-C", root, "add", "local-base.txt"]);
		await run(["git", "-C", root, "commit", "-m", "local base"]);
		await run(["git", "-C", root, "checkout", "main"]);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/from-local-base", "--base", "local/base", "--json"],
			warnDeps,
		);
		expect(
			(await run(["git", "-C", `${root}__feature--from-local-base`, "show", "HEAD:local-base.txt"]))
				.stdout,
		).toBe("local base\n");

		await run(["git", "-C", root, "branch", "feature/base-ignored"]);
		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/base-ignored", "--base", "base/topic", "--json"],
			warnDeps,
		);
		expect(warnings.join("\n")).toContain("--base ignored");
	});

	test("--base-current stacks a new branch on the worktree containing cwd", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/parent", "--json"], deps);
		const parentPath = `${root}__feature--parent`;
		writeFileSync(join(parentPath, "parent.txt"), "parent\n");
		await run(["git", "-C", parentPath, "add", "parent.txt"]);
		await run(["git", "-C", parentPath, "commit", "-m", "parent work"]);
		const nestedCwd = join(parentPath, "nested");
		mkdirSync(nestedCwd, { recursive: true });

		const result = await dispatch(
			"add",
			["--cwd", nestedCwd, "--branch", "feature/child", "--base-current", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feature--child`, "show", "HEAD:parent.txt"])).stdout,
		).toBe("parent\n");
	});

	test("--base-current from canonical root stacks on the canonical branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		writeFileSync(join(root, "canonical.txt"), "canonical\n");
		await run(["git", "-C", root, "add", "canonical.txt"]);
		await run(["git", "-C", root, "commit", "-m", "canonical work"]);

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/from-canonical", "--base-current", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feature--from-canonical`, "show", "HEAD:canonical.txt"]))
				.stdout,
		).toBe("canonical\n");
	});

	test("--base-current refuses a detached worktree", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		await dispatch("add", ["--cwd", root, "--branch", "feature/detached", "--json"], deps);
		const worktreePath = `${root}__feature--detached`;
		await run(["git", "-C", worktreePath, "checkout", "--detach"]);

		await expect(
			dispatch(
				"add",
				["--cwd", worktreePath, "--branch", "feature/stacked", "--base-current", "--json"],
				deps,
			),
		).rejects.toThrow("--base-current requires the worktree containing --cwd to be on a branch");
		expect(existsSync(`${root}__feature--stacked`)).toBe(false);
	});

	test("--base-current is refused together with --base", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");

		await expect(
			dispatch(
				"add",
				[
					"--cwd",
					root,
					"--branch",
					"feature/conflicting-base",
					"--base-current",
					"--base",
					"main",
					"--json",
				],
				deps,
			),
		).rejects.toThrow("--base-current cannot be combined with --base");
	});

	test("non-json add prints a one-line summary to stderr", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");

		const result = await dispatch("add", ["--cwd", root, "--branch", "feature/human"], deps);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBeUndefined();
		expect(result.stderr).toBe(`honeycomb: added feature/human at ${root}__feature--human\n`);
	});

	test("accepts --force for wrapper compatibility", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready");
		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/force", "--force", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(0);
		expect(existsSync(`${root}__feature--force`)).toBe(true);
	});

	test("without project config post_create_script_path is null", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "empty-config"));

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/no-project", "--json"],
			deps,
		);

		expect(JSON.parse(result.stdout ?? "{}").post_create_script_path).toBeNull();
	});

	test("rejects reserved pool branch prefix", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		await expect(
			dispatch("add", ["--cwd", root, "--branch", "wk-pool/feat1", "--json"], deps),
		).rejects.toThrow("reserved");
	});
});
