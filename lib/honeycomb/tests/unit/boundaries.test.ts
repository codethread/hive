import { expect, test } from "bun:test";
import { buildPoolState } from "../../src/application/pool.ts";
import { runPreRemoteCheck } from "../../src/application/preflight.ts";
import { explainPolicy, type TreesConfig } from "../../src/domain/config.ts";
import { PreRemoteCheckError } from "../../src/errors.ts";
import { parseWorktreeList } from "../../src/git/worktrees.ts";
import { toListJson } from "../../src/protocol.ts";
import type { GitRunner } from "../../src/services.ts";

const run: GitRunner["runRaw"] = async (args) => {
	const stdout = args.includes("symbolic-ref")
		? "refs/remotes/origin/main\n"
		: args.includes("log")
			? "2026-01-01T00:00:00Z\x1finitial\n"
			: args.includes("rev-parse")
				? "../repo/.git/worktrees/feat1/wk-pool-initialized\n"
				: "";
	return { stdout, stderr: "", exitCode: 0 };
};

test("preflight uses the injected command runner and preserves failure diagnostics", async () => {
	const config: TreesConfig = {
		projects: [],
		rules: [{ rootGlob: "/repo", command: null, preRemoteCheck: "check-network" }],
		defaults: {},
		worktreeLocation: "sibling",
	};
	const calls: string[][] = [];
	await expect(
		runPreRemoteCheck(
			{
				config: { read: () => config, explain: explainPolicy },
				hooks: {
					runInline: async () => undefined,
					runCommand: async (script, cwd) => {
						calls.push([script, cwd]);
						return { stdout: [], stderr: ["offline"], exitCode: 1 };
					},
				},
			},
			{ config, root: "/repo", operation: "honeycomb add" },
		),
	).rejects.toMatchObject({
		name: PreRemoteCheckError.name,
		stderr: "offline",
		exitCode: 10,
	});
	expect(calls).toEqual([["check-network", "/repo"]]);
});

test("pool status observes initialization through the injected filesystem", async () => {
	const worktrees = parseWorktreeList(
		"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo__feat1\nHEAD abc\nbranch refs/heads/wk-pool/feat1\n",
	);

	const observedPaths: string[] = [];
	const state = await buildPoolState(
		{
			name: "repo",
			root: "/repo",
			command: "setup",
			poolSize: 1,
			copyModeDefault: "copy",
			copy: [],
		},
		worktrees,
		{
			git: { run, runRaw: run },
			files: {
				normalizePath: (path) => path,
				exists: (path) => {
					observedPaths.push(path);
					return true;
				},
			},
		},
	);
	expect(state.slots[0]).toMatchObject({ initialized: true, placeholder: true, dirty: false });
	expect(observedPaths).toEqual(["/repo/.git/worktrees/feat1/wk-pool-initialized"]);
});

test("list rendering retains Git metadata when worktree values are copied", () => {
	const worktrees = parseWorktreeList(
		"worktree /repo\nHEAD abc\nbranch refs/heads/main\nlocked maintenance\nprunable missing checkout\n",
	);
	expect(worktrees.map((worktree) => toListJson({ ...worktree }))).toMatchObject([
		{
			locked: true,
			lock_reason: "maintenance",
			prunable: true,
			prunable_reason: "missing checkout",
			session: { name: "repo", path: "/repo" },
		},
	]);
});
