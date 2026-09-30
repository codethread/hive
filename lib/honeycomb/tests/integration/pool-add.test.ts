import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	BlockedError,
	ConfigError,
	dispatch,
	EXIT_CODES,
	HookError,
	PreRemoteCheckError,
	ReservedPrefixError,
} from "../../src/index";
import {
	setTestEnv,
	restoreTestEnv,
	TestPicker,
	testDeps,
	writeConfig,
	useOriginFixture,
	createRemoteBranch,
	commitOnRemoteDefault,
	run,
	runRaw,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

const FAIL_OUTSIDE_PLACEHOLDER = '[[ "$(git branch --show-current)" == wk-pool/* ]] || exit 7';

describe("honeycomb pooled add", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-pool-add-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("pre_remote_check blocks pooled status before remote trunk detection", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await commitOnRemoteDefault({
			remote,
			path: "pooled-status-remote.txt",
			content: "remote\n",
			message: "remote before blocked status",
		});
		writeConfig(
			tmp,
			root,
			"echo ready",
			1,
			'pre_remote_check = "echo pooled blocked >&2; exit 7"\n',
		);

		const result = await dispatch("status", ["--cwd", root, "--json"], testDeps());

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(result.stderr).toBeUndefined();
		expect(result.failure).toBeInstanceOf(PreRemoteCheckError);
		expect(result.failure).toMatchObject({ stderr: "pooled blocked" });
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			ok: false,
			kind: "blocked",
			reason: "pre_remote_check_failed",
		});
		expect(
			(await runRaw(["git", "-C", root, "show", "origin/main:pooled-status-remote.txt"])).exitCode,
		).not.toBe(0);
	});

	test("fresh_canonical blocks dirty canonical root before pooled slot allocation", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "pooled-dirty-block.txt",
			content: "remote\n",
			message: "pooled dirty block update",
		});
		writeFileSync(join(root, "dirty.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pooled-dirty-block", "--json"],
			testDeps(),
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_canonical",
		});
		expect(existsSync(`${root}__feat1`)).toBe(false);
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/pooled-dirty-block",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("fresh_canonical fast-forwards canonical root before pooled branch checkout", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1, '[project.add]\npolicy = "fresh_canonical"\n');
		await commitOnRemoteDefault({
			remote,
			path: "pooled-fresh.txt",
			content: "fresh pooled\n",
			message: "pooled fresh update",
		});

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pooled-fresh", "--json"],
			testDeps(),
		);

		expect((await run(["git", "-C", root, "show", "HEAD:pooled-fresh.txt"])).stdout).toBe(
			"fresh pooled\n",
		);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "show", "HEAD:pooled-fresh.txt"])).stdout,
		).toBe("fresh pooled\n");
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/pooled-fresh");
	});

	test("origin_default pooled add uses fetched origin default without mutating canonical root", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await commitOnRemoteDefault({
			remote,
			path: "pooled-origin-default.txt",
			content: "origin default\n",
			message: "pooled origin default update",
		});
		const originalHead = (await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim();

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pooled-origin-default", "--json"],
			testDeps(),
		);

		expect((await run(["git", "-C", root, "rev-parse", "HEAD"])).stdout.trim()).toBe(originalHead);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "show", "HEAD:pooled-origin-default.txt"])).stdout,
		).toBe("origin default\n");
	});

	test("fresh_canonical pooled explicit base bypasses canonical update requirement", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "base/policy-check");
		writeConfig(tmp, root, "echo ready", 1, '[project.add]\npolicy = "fresh_canonical"\n');
		writeFileSync(join(root, "dirty.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			[
				"--cwd",
				root,
				"--branch",
				"feature/pooled-from-base",
				"--base",
				"base/policy-check",
				"--json",
			],
			testDeps(),
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			worktree_path: `${root}__feat1`,
			branch: "feature/pooled-from-base",
		});
		expect((await run(["git", "-C", `${root}__feat1`, "show", "HEAD:remote.txt"])).stdout).toBe(
			"base/policy-check\n",
		);
	});

	test("fresh_canonical policy failure does not recycle an occupied pooled slot", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1, '[project.add]\npolicy = "fresh_canonical"\n');
		await dispatch("add", ["--cwd", root, "--branch", "feature/occupied", "--json"], testDeps());
		await commitOnRemoteDefault({
			remote,
			path: "pooled-recycle-block.txt",
			content: "remote\n",
			message: "pooled recycle block update",
		});
		writeFileSync(join(root, "dirty.txt"), "dirty\n");

		const result = await dispatch(
			"add",
			[
				"--cwd",
				root,
				"--branch",
				"feature/blocked-recycle",
				"--json",
				"--slot",
				`${root}__feat1`,
				"--force",
			],
			testDeps(),
		);

		expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "dirty_canonical",
		});
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/occupied");
		expect(
			(
				await runRaw([
					"git",
					"-C",
					root,
					"show-ref",
					"--verify",
					"refs/heads/feature/blocked-recycle",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("keeps legacy pool slots and creates only missing slots in the preferred location", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		const configHome = join(tmp, "config-mixed-pool");
		mkdirSync(configHome, { recursive: true });
		setTestEnv("XDG_CONFIG_HOME", configHome);
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`[[project]]\nroot = "${root}"\ncommand = "echo ready"\npool_size = 1\n`,
		);
		const legacySlot = `${root}__feat1`;
		await dispatch("add", ["--cwd", root, "--branch", "feature/legacy-pool", "--json"], testDeps());

		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`worktree_location = "sibling"\n\n[[project]]\nroot = "${root}"\ncommand = "echo ready"\npool_size = 2\nworktree_location = "nested"\n`,
		);
		const nestedSlot = join(root, ".worktrees", "feat2");
		await dispatch("ensure", ["--cwd", root], testDeps());
		const state = JSON.parse(
			(await dispatch("status", ["--cwd", root], testDeps())).stdout ?? "{}",
		);

		expect(state.slots.map((slot: { path: string }) => slot.path)).toEqual([
			legacySlot,
			nestedSlot,
		]);
		expect(
			(await dispatch("path", ["--cwd", root, "--branch", "feature/legacy-pool"], testDeps()))
				.stdout,
		).toBe(`${legacySlot}\n`);
		expect(existsSync(nestedSlot)).toBe(true);
		expect((await run(["git", "-C", root, "status", "--porcelain"])).stdout).toBe("");

		const removed = await dispatch(
			"remove",
			["--cwd", root, "--branch", "feature/legacy-pool", "--keep-branch", "--json"],
			testDeps(),
		);
		expect(JSON.parse(removed.stdout ?? "{}")).toMatchObject({
			worktree_path: legacySlot,
			removed: false,
		});
		expect((await run(["git", "-C", legacySlot, "branch", "--show-current"])).stdout.trim()).toBe(
			"wk-pool/feat1",
		);
	});

	test("allocates the lowest initialized free slot and runs setup", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(
			tmp,
			root,
			'git branch --show-current > "$(git rev-parse --git-path setup-branch)"',
			2,
		);
		await dispatch("ensure", ["--cwd", root], testDeps());

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pooled", "--json"],
			testDeps(),
		);

		const plan = JSON.parse(result.stdout ?? "{}");
		expect(plan).toMatchObject({
			worktree_path: `${root}__feat1`,
			branch: "feature/pooled",
			post_create_script_path: null,
			created_new_branch: true,
		});
		const setupBranchPath = (
			await run(["git", "-C", `${root}__feat1`, "rev-parse", "--git-path", "setup-branch"])
		).stdout.trim();
		expect(readFileSync(resolve(`${root}__feat1`, setupBranchPath), "utf8")).toBe(
			"feature/pooled\n",
		);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/pooled");
		expect(
			(await run(["git", "-C", `${root}__feat2`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat2");
	});

	test("copies into allocated slot after checkout and before setup", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeFileSync(join(root, ".env"), "pooled\n");
		writeConfig(tmp, root, 'cat .env > "$WK_CREATED/allocated-read"', 1, 'copy = [".env"]\n');
		await dispatch("ensure", ["--cwd", root], testDeps());

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/allocated-copy", "--json"],
			testDeps(),
		);

		expect(readFileSync(join(`${root}__feat1`, ".env"), "utf8")).toBe("pooled\n");
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/allocated-copy");
		expect(readFileSync(join(`${root}__feat1`, "allocated-read"), "utf8")).toBe("pooled\n");
	});

	test("setup failure during allocation frees the slot and deletes the new branch", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, FAIL_OUTSIDE_PLACEHOLDER, 1);
		await dispatch("ensure", ["--cwd", root], testDeps());

		const { failure } = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/setup-fail", "--json"],
			testDeps(),
		);
		expect(failure).toBeInstanceOf(HookError);

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(
			(await runRaw(["git", "-C", root, "show-ref", "--verify", "refs/heads/feature/setup-fail"]))
				.exitCode,
		).not.toBe(0);
	});

	test("setup failure during allocation restores an existing branch tip", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		await run(["git", "-C", root, "branch", "feature/pool-setup-restore"]);
		const originalHead = (
			await run(["git", "-C", root, "rev-parse", "refs/heads/feature/pool-setup-restore"])
		).stdout.trim();
		writeConfig(tmp, root, FAIL_OUTSIDE_PLACEHOLDER, 1);
		await dispatch("ensure", ["--cwd", root], testDeps());

		const { failure } = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pool-setup-restore", "--json"],
			testDeps(),
		);
		expect(failure).toBeInstanceOf(HookError);

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(
			(
				await run(["git", "-C", root, "rev-parse", "refs/heads/feature/pool-setup-restore"])
			).stdout.trim(),
		).toBe(originalHead);
	});

	test("copy setup failure during allocation restores the slot placeholder", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("ensure", ["--cwd", root], testDeps());
		writeConfig(tmp, root, "echo should-not-run", 1, 'copy = [".env.missing"]\n');

		const { failure } = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/allocated-copy-fail", "--json"],
			testDeps(),
		);
		expect(failure).toBeInstanceOf(ConfigError);

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
					"refs/heads/feature/allocated-copy-fail",
				])
			).exitCode,
		).not.toBe(0);
	});

	test("copy setup failure during allocation restores an existing branch tip", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/pool-restore-tip");
		await run(["git", "-C", root, "fetch", "origin"]);
		await run(["git", "-C", root, "branch", "feature/pool-restore-tip", "main"]);
		const originalHead = (
			await run(["git", "-C", root, "rev-parse", "refs/heads/feature/pool-restore-tip"])
		).stdout.trim();
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("ensure", ["--cwd", root], testDeps());
		writeConfig(tmp, root, "echo should-not-run", 1, 'copy = [".env.missing"]\n');

		const { failure } = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/pool-restore-tip", "--json"],
			testDeps(),
		);
		expect(failure).toBeInstanceOf(ConfigError);

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat1");
		expect(
			(
				await run(["git", "-C", root, "rev-parse", "refs/heads/feature/pool-restore-tip"])
			).stdout.trim(),
		).toBe(originalHead);
	});

	test.each([
		{ name: "existing remote-only", branch: "feature/remote-pool", source: "remote" },
		{ name: "existing local", branch: "feature/local-pool", source: "local" },
	])("allocates $name branch", async ({ branch, source }) => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		if (source === "remote") await createRemoteBranch(remote, branch);
		else await run(["git", "-C", root, "branch", branch]);
		writeConfig(tmp, root, "echo ready", 1);

		await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], testDeps());

		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe(branch);
	});

	test("warns for diverged branches and rejects duplicates without side effects", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "feature/diverged-pool");
		await run(["git", "-C", root, "fetch", "origin"]);
		await run(["git", "-C", root, "checkout", "-b", "feature/diverged-pool", "main"]);
		writeFileSync(join(root, "local.txt"), "local\n");
		await run(["git", "-C", root, "add", "local.txt"]);
		await run(["git", "-C", root, "commit", "-m", "local"]);
		await run(["git", "-C", root, "checkout", "main"]);
		writeConfig(tmp, root, "echo ready", 2);
		const warnDeps = testDeps();

		const diverged = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/diverged-pool", "--json"],
			warnDeps,
		);
		expect(JSON.parse(diverged.stdout ?? "{}").diagnostics).toMatchInlineSnapshot(`
		  [
		    "[wk-pool] initializing feat1…",
		    "[wk-pool] initializing feat2…",
		    "warning: couldn't fast-forward from origin/feature/diverged-pool; preserving local work",
		  ]
		`);

		const duplicate = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/diverged-pool", "--json"],
			testDeps(),
		);
		expect(JSON.parse(duplicate.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "duplicate_branch",
			message: expect.stringContaining(`${root}__feat1`),
		});
		expect(
			(await run(["git", "-C", `${root}__feat2`, "branch", "--show-current"])).stdout.trim(),
		).toBe("wk-pool/feat2");
	});

	test("rejects duplicate canonical branch and reserved branch before allocation", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);

		const duplicate = await dispatch(
			"add",
			["--cwd", root, "--branch", "main", "--json"],
			testDeps(),
		);
		expect(JSON.parse(duplicate.stdout ?? "{}")).toMatchObject({
			kind: "blocked",
			reason: "duplicate_branch",
			message: expect.stringContaining(root),
		});
		const { failure } = await dispatch(
			"add",
			["--cwd", root, "--branch", "wk-pool/feat9", "--json"],
			testDeps(),
		);
		expect(failure).toBeInstanceOf(ReservedPrefixError);
		expect(existsSync(`${root}__feat1`)).toBe(false);
	});

	test("pooled path finds allocated branch and --base only affects new branches", async () => {
		const { root, remote } = await initRepoWithOrigin(tmp);
		await createRemoteBranch(remote, "base/pool");
		await run(["git", "-C", root, "fetch", "origin"]);
		await run(["git", "-C", root, "branch", "feature/existing-base"]);
		writeConfig(tmp, root, "echo ready", 2);
		const warnDeps = testDeps();

		await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/from-base", "--base", "base/pool", "--json"],
			warnDeps,
		);
		expect((await run(["git", "-C", `${root}__feat1`, "show", "HEAD:remote.txt"])).stdout).toBe(
			"base/pool\n",
		);
		expect(
			(await dispatch("path", ["--cwd", root, "--branch", "feature/from-base"], warnDeps)).stdout,
		).toBe(`${root}__feat1\n`);
		const { failure } = await dispatch(
			"path",
			["--cwd", root, "--branch", "feature/missing"],
			warnDeps,
		);
		expect(failure).toBeInstanceOf(BlockedError);

		const ignored = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/existing-base", "--base", "base/pool", "--json"],
			warnDeps,
		);
		expect(JSON.parse(ignored.stdout ?? "{}").diagnostics).toMatchInlineSnapshot(`
		  [
		    "--base ignored: branch already exists",
		  ]
		`);
	});

	test("machine json add reports pool_full and --slot selects a specific slot", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/one", "--json"], testDeps());

		const blocked = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/two", "--json"],
			testDeps({ picker: new TestPicker(null, true) }),
		);

		expect(blocked.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
			kind: "pool_full",
			root,
			branch: "feature/two",
			candidates: [
				{
					slot: 1,
					path: `${root}__feat1`,
					branch: "feature/one",
					dirty: false,
					local_only: true,
				},
			],
		});

		const selected = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/two", "--json", "--slot", `${root}__feat1`, "--force"],
			testDeps({ picker: new TestPicker(null, true) }),
		);

		expect(selected.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(JSON.parse(selected.stdout ?? "{}")).toMatchObject({
			kind: "ready",
			worktree_path: `${root}__feat1`,
			branch: "feature/two",
			session: { name: "repo__feat1", path: `${root}__feat1` },
		});
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/two");
	});

	test("machine json pool_full bypasses picker and leaves the occupied slot untouched", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/one", "--json"], testDeps());
		await run([
			"git",
			"-C",
			`${root}__feat1`,
			"branch",
			"--set-upstream-to",
			"origin/main",
			"feature/one",
		]);
		const picker = new TestPicker("1", true);

		const blocked = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/two", "--json"],
			testDeps({ picker }),
		);

		expect(blocked.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
			kind: "pool_full",
			branch: "feature/two",
			candidates: [{ slot: 1, path: `${root}__feat1`, branch: "feature/one" }],
		});
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/one");
		expect(picker.items).toEqual([]);
		expect(picker.confirmCalls).toBe(0);
	});

	test("machine json pool_full ignores picker state and --force without mutating the slot", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/one", "--json"], testDeps());

		const cancelPicker = new TestPicker(null, true);
		const cancelBlocked = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/cancel", "--json"],
			testDeps({ picker: cancelPicker }),
		);
		expect(cancelBlocked.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(cancelBlocked.stdout ?? "{}")).toMatchObject({
			kind: "pool_full",
			branch: "feature/cancel",
		});
		expect(cancelPicker.items).toEqual([]);
		expect(cancelPicker.confirmCalls).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/one");

		const noPicker = new TestPicker("1", false);
		const noBlocked = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/no", "--json"],
			testDeps({ picker: noPicker }),
		);
		expect(noBlocked.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(noBlocked.stdout ?? "{}")).toMatchObject({
			kind: "pool_full",
			branch: "feature/no",
		});
		expect(noPicker.items).toEqual([]);
		expect(noPicker.confirmCalls).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/one");

		const forcePicker = new TestPicker("1", false);
		const forceBlocked = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/forced", "--force", "--json"],
			testDeps({ picker: forcePicker }),
		);
		expect(forceBlocked.exitCode).toBe(EXIT_CODES.BLOCKED);
		expect(JSON.parse(forceBlocked.stdout ?? "{}")).toMatchObject({
			kind: "pool_full",
			branch: "feature/forced",
		});
		expect(forcePicker.items).toEqual([]);
		expect(forcePicker.confirmCalls).toBe(0);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/one");
	});

	test("human pool_full recycle tells the picker the invocation is not interactive", async () => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig(tmp, root, "echo ready", 1);
		await dispatch("add", ["--cwd", root, "--branch", "feature/one", "--json"], testDeps());
		const picker = new TestPicker("1", true);

		const recycled = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/two"],
			testDeps({ picker }),
		);

		expect(recycled.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(picker.options).toEqual({ interactive: false });
		expect(picker.confirmCalls).toBe(1);
		expect(
			(await run(["git", "-C", `${root}__feat1`, "branch", "--show-current"])).stdout.trim(),
		).toBe("feature/two");
	});
});
