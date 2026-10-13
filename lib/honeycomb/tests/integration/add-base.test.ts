import { EXIT_CODES, UsageError, dispatch } from "../../src/index";
import { commitFile, deps, pathExists, run, useOriginFixture, writeConfig } from "./support.ts";
import { expect, test } from "bun:test";
import { gitText, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { mkdir } from "node:fs/promises";

const tmp = useTmpHome("honeycomb-add-base-test-");
const { initRepoWithOrigin } = useOriginFixture();

test("--base-current stacks a new branch on the worktree containing cwd", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/parent", "--json"], deps);
	const parentPath = `${root}__feature--parent`;
	await commitFile({
		content: "parent\n",
		message: "parent work",
		path: "parent.txt",
		repo: parentPath,
	});
	const nestedCwd = join(parentPath, "nested");
	await mkdir(nestedCwd, { recursive: true });

	const result = await dispatch(
		"add",
		["--cwd", nestedCwd, "--branch", "feature/child", "--base-current", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await gitText(`${root}__feature--child`, "show", "HEAD:parent.txt")).toBe("parent\n");
});
test("--base-current from canonical root stacks on the canonical branch", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await commitFile({
		content: "canonical\n",
		message: "canonical work",
		path: "canonical.txt",
		repo: root,
	});

	const result = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/from-canonical", "--base-current", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await gitText(`${root}__feature--from-canonical`, "show", "HEAD:canonical.txt")).toBe(
		"canonical\n",
	);
});
test("--base-current refuses a detached worktree", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/detached", "--json"], deps);
	const worktreePath = `${root}__feature--detached`;
	await run(["git", "-C", worktreePath, "checkout", "--detach"]);

	const { failure } = await dispatch(
		"add",
		["--cwd", worktreePath, "--branch", "feature/stacked", "--base-current", "--json"],
		deps,
	);
	expect(failure).toBeInstanceOf(UsageError);
	expect(await pathExists(`${root}__feature--stacked`)).toBe(false);
});
test("--base-current is refused together with --base", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", root, tmp: tmp.dir });

	const { failure } = await dispatch(
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
	);
	expect(failure).toBeInstanceOf(UsageError);
});
