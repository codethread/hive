import { EXIT_CODES, UsageError, dispatch } from "../../src/index";
import { commitFile, deps, pathExists, useOriginFixture, writeConfig } from "./support.ts";
import { expect, test } from "bun:test";
import { gitSucceeds, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { mkdir } from "node:fs/promises";

const tmp = useTmpHome("honeycomb-remove-test-");
const { initRepoWithOrigin } = useOriginFixture();

const setupUnmergedWorktree = async (home: string, branch: string) => {
	const { root } = await initRepoWithOrigin(home);
	writeConfig({ command: "echo ready", root, tmp: home });
	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], deps);
	const path = `${root}__${branch.replaceAll("/", "--")}`;
	await commitFile({ content: "work\n", message: "unmerged", path: "unmerged.txt", repo: path });
	return { path, root };
};

test("removes a non-pool worktree and branch", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/remove", "--json"], deps);

	const result = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/remove", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	const plan = JSON.parse(result.stdout ?? "{}");
	expect(await pathExists(`${root}__feature--remove`)).toBe(false);
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/remove")).toBe(false);
	expect(plan).toMatchObject({
		kind: "ready",
		removed: true,
		session: {
			name: "repo__feature--remove",
			path: `${root}__feature--remove`,
		},
		worktree_path: `${root}__feature--remove`,
	});
});

test("removes the worktree containing --cwd with boolean --self", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/self", "--json"], deps);
	const worktreePath = `${root}__feature--self`;
	const nested = join(worktreePath, "nested");
	await mkdir(nested, { recursive: true });

	const result = await dispatch("remove", ["--cwd", nested, "--self", "--json"], deps);

	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "ready",
		removed: true,
		worktree_path: worktreePath,
	});
	expect(await pathExists(worktreePath)).toBe(false);
});

test("non-json remove prints a one-line summary to stderr", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/human-remove", "--json"], deps);

	const result = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/human-remove"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(result.stdout).toBeUndefined();
	expect(result.stderr).toBe(`honeycomb: removed worktree at ${root}__feature--human-remove\n`);
});

test("removes non-pool branches whose encoded paths resemble pool slots", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feat1", "--json"], deps);

	await dispatch("remove", ["--cwd", root, "--branch", "feat1", "--json"], deps);

	expect(await pathExists(`${root}__feat1`)).toBe(false);
});

test("unmerged branch fails without --force and succeeds with --force", async () => {
	const { path, root } = await setupUnmergedWorktree(tmp.dir, "feature/unmerged");

	const blocked = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/unmerged", "--json"],
		deps,
	);
	expect(blocked.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(blocked.stdout ?? "{}")).toMatchObject({
		branch: "feature/unmerged",
		kind: "blocked",
		reason: "unmerged_branch",
		worktree_path: path,
	});
	expect(await pathExists(path)).toBe(true);

	await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/unmerged", "--force", "--json"],
		deps,
	);
	expect(await pathExists(path)).toBe(false);
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/unmerged")).toBe(
		false,
	);
});

test("machine json remove reports blocked outcomes with unsafe exit codes", async () => {
	const { path, root } = await setupUnmergedWorktree(tmp.dir, "feature/unmerged-json");

	const result = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/unmerged-json", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		branch: "feature/unmerged-json",
		kind: "blocked",
		reason: "unmerged_branch",
		worktree_path: path,
	});
	expect(await pathExists(path)).toBe(true);
});

test("refuses canonical root and requires exactly one target selector", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });

	const canonicalRoot = await dispatch("remove", ["--cwd", root, "--self", "--json"], deps);
	expect(canonicalRoot.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(canonicalRoot.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "canonical_root",
	});
	const { failure } = await dispatch("remove", ["--cwd", root, "--json"], deps);
	expect(failure).toBeInstanceOf(UsageError);
});
