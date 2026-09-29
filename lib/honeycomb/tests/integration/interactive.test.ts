import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Deps, dispatch, EXIT_CODES } from "../../src/index";
import {
	TestCdDirective,
	TestMultiplexer,
	commitFile,
	restoreTestEnv,
	setTestEnv,
	testDeps,
	useOriginFixture,
	writeConfig,
} from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

const interactiveDeps = (attached = true) => {
	const log: string[] = [];
	const multiplexer = new TestMultiplexer(attached, log);
	const cdDirective = new TestCdDirective(log);
	const warnings: string[] = [];
	const deps = testDeps({
		multiplexer,
		cdDirective,
		progress: {
			banner: () => undefined,
			stream: () => undefined,
			error: (msg) => warnings.push(msg),
		},
	});
	return { deps, log, multiplexer, cdDirective, warnings };
};

const run = async (subcommand: string, args: string[], deps: Deps) => {
	const result = await dispatch(subcommand, args, deps);
	await result.afterOutput?.();
	return result;
};

describe("honeycomb --interactive", () => {
	let tmp: string;
	let root: string;

	beforeEach(async () => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-interactive-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
		({ root } = await initRepoWithOrigin(tmp));
		writeConfig(tmp, root, "echo ready");
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("add opens the new worktree's session after output", async () => {
		const { deps, log, multiplexer } = interactiveDeps();

		const result = await dispatch(
			"add",
			["--cwd", root, "--branch", "feature/open", "--json", "--interactive"],
			deps,
		);

		expect(log).toEqual([]);
		await result.afterOutput?.();
		expect(multiplexer.opened).toEqual([
			{
				name: "repo__feature--open",
				title: "feature/open",
				path: `${root}__feature--open`,
			},
		]);
		expect(log).toEqual([`open ${root}__feature--open`]);
	});

	test("add outside a multiplexer writes the worktree path to the cd directive", async () => {
		const { deps, log } = interactiveDeps(false);

		await run("add", ["--cwd", root, "--branch", "feature/cd", "--interactive"], deps);

		expect(log).toEqual([`cd ${root}__feature--cd`]);
	});

	test("without --interactive, add and remove make no session calls or cd directive", async () => {
		const { deps, log } = interactiveDeps();

		await run("add", ["--cwd", root, "--branch", "feature/quiet", "--json"], deps);
		const worktreePath = `${root}__feature--quiet`;
		const result = await run(
			"remove",
			["--cwd", worktreePath, "--branch", "feature/quiet", "--json"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(result.afterOutput).toBeUndefined();
		expect(log).toEqual([]);
	});

	test("remove from inside the worktree writes the canonical root, then closes sessions last", async () => {
		const { deps, log } = interactiveDeps();
		await dispatch("add", ["--cwd", root, "--branch", "feature/leave", "--json"], deps);
		const worktreePath = `${root}__feature--leave`;

		const result = await dispatch(
			"remove",
			["--cwd", join(worktreePath, "."), "--branch", "feature/leave", "--json", "--interactive"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(existsSync(worktreePath)).toBe(false);
		expect(log).toEqual([]);
		await result.afterOutput?.();
		expect(log).toEqual([`cd ${root}`, `close ${worktreePath}`]);
	});

	test("remove from outside the worktree closes sessions without a cd directive", async () => {
		const { deps, log } = interactiveDeps();
		await dispatch("add", ["--cwd", root, "--branch", "feature/other", "--json"], deps);

		await run(
			"remove",
			["--cwd", root, "--branch", "feature/other", "--json", "--interactive"],
			deps,
		);

		expect(log).toEqual([`close ${root}__feature--other`]);
	});

	test("pooled add opens the slot and pooled remove leaves and closes it", async () => {
		writeConfig(tmp, root, "echo ready", 1);
		const { deps, log } = interactiveDeps();
		const slotPath = `${root}__feat1`;

		await run(
			"add",
			["--cwd", root, "--branch", "feature/pooled", "--json", "--interactive"],
			deps,
		);
		await run(
			"remove",
			["--cwd", slotPath, "--branch", "feature/pooled", "--keep-branch", "--json", "--interactive"],
			deps,
		);

		expect(existsSync(slotPath)).toBe(true);
		expect(log).toEqual([`open ${slotPath}`, `cd ${root}`, `close ${slotPath}`]);
	});

	test("session failures warn without undoing the removal", async () => {
		const { deps, warnings } = interactiveDeps();
		await dispatch("add", ["--cwd", root, "--branch", "feature/warn", "--json"], deps);
		warnings.length = 0;
		deps.multiplexer.closeUnder = () => Promise.reject(new Error("tmux exploded"));

		const result = await run(
			"remove",
			["--cwd", root, "--branch", "feature/warn", "--json", "--interactive"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(existsSync(`${root}__feature--warn`)).toBe(false);
		expect(warnings).toEqual(["warning: couldn't close multiplexer sessions: tmux exploded"]);
	});

	test("finish cleanup leaves the removed worktree and closes its sessions", async () => {
		writeConfig(tmp, root, "echo ready", undefined, "[project.finish]\nremove_worktree = true\n");
		const { deps, log } = interactiveDeps();
		await dispatch("add", ["--cwd", root, "--branch", "feature/finish", "--json"], deps);
		const worktreePath = `${root}__feature--finish`;
		await commitFile({ repo: worktreePath, path: "a.txt", content: "a\n", message: "work" });

		const result = await dispatch(
			"finish",
			["--cwd", worktreePath, "--json", "--interactive"],
			deps,
		);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(log).toEqual([]);
		await result.afterOutput?.();
		expect(log).toEqual([`cd ${root}`, `close ${worktreePath}`]);
	});

	test("finish without cleanup leaves sessions alone", async () => {
		const { deps, log } = interactiveDeps();
		await dispatch("add", ["--cwd", root, "--branch", "feature/keep", "--json"], deps);
		const worktreePath = `${root}__feature--keep`;
		await commitFile({ repo: worktreePath, path: "b.txt", content: "b\n", message: "work" });

		const result = await run("finish", ["--cwd", worktreePath, "--json", "--interactive"], deps);

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(log).toEqual([]);
	});
});
