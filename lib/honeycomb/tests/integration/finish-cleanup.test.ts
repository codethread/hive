import { EXIT_CODES, dispatch } from "../../src/index";
import {
	commitFile,
	deps,
	pathExists,
	testDeps,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, gitSucceeds, gitText, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join, resolve } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { writeFile } from "node:fs/promises";

const SINGLE_SLOT = 1;

const tmp = useTmpHome("honeycomb-finish-cleanup-test-");
const { initRepoWithOrigin } = useOriginFixture();

const prepareFinish = async (branch: string, policy = "") => {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", copyToml: policy, root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], deps);
	return { remote, root, worktreePath: `${root}__${branch.replaceAll("/", "--")}` };
};

const preparePooledFinish = async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({
		command: "mkdir -p node_modules; touch node_modules/.keep",
		copyToml: "[project.finish]\nremove_worktree = true\n",
		poolSize: SINGLE_SLOT,
		root,
		tmp: tmp.dir,
	});
	await dispatch("ensure", ["--cwd", root], testDeps());
	const excludePath = await gitOut(`${root}__feat1`, "rev-parse", "--git-path", "info/exclude");
	await writeFile(resolve(`${root}__feat1`, excludePath), "node_modules/\n");
	await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/pooled-finish", "--slot", `${root}__feat1`, "--json"],
		testDeps(),
	);

	return root;
};

test("removes a non-pooled source worktree after finish when cleanup is enabled", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/remove-after-finish",
		"[project.finish]\nremove_worktree = true\n",
	);
	await commitFile({
		content: "remove\n",
		message: "remove work",
		path: "remove.txt",
		repo: worktreePath,
	});

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		cleanup_actions: ["remove_worktree"],
	});
	expect(await pathExists(worktreePath)).toBe(false);
	expect(
		await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/remove-after-finish"),
	).toBe(true);
});
test("recycles a pooled local-only source worktree after finish while preserving ignored files", async () => {
	const root = await preparePooledFinish();
	await commitFile({
		content: "pooled\n",
		message: "pooled work",
		path: "pooled.txt",
		repo: `${root}__feat1`,
	});

	const result = await dispatch("finish", ["--cwd", `${root}__feat1`, "--json"], testDeps());

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		cleanup_actions: ["recycle_worktree"],
	});
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await pathExists(join(`${root}__feat1`, "node_modules", ".keep"))).toBe(true);
});
test("deletes source branch after squash finish when configured", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/delete-after-squash",
		'[project.finish]\nstrategy = "squash"\nremove_worktree = true\ndelete_branch = true\n',
	);
	await commitFile({
		content: "delete\n",
		message: "delete work",
		path: "squash-delete.txt",
		repo: worktreePath,
	});

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		cleanup_actions: ["remove_worktree", "delete_branch"],
	});
	expect(
		await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/delete-after-squash"),
	).toBe(false);
});
test("configured finish cleanup enables push, removal, and branch deletion", async () => {
	const { remote, root, worktreePath } = await prepareFinish(
		"feature/policy-cleanup",
		"[project.finish]\npush = true\nremove_worktree = true\ndelete_branch = true\n",
	);
	await commitFile({
		content: "policy\n",
		message: "policy cleanup",
		path: "policy-cleanup.txt",
		repo: worktreePath,
	});

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		cleanup_actions: ["push", "remove_worktree", "delete_branch"],
	});
	expect(await gitText(remote, "show", "main:policy-cleanup.txt")).toBe("policy\n");
	expect(await pathExists(worktreePath)).toBe(false);
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/policy-cleanup")).toBe(
		false,
	);
});
test("cleanup refusal returns structured payload without integration or force deletion", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/delete-without-remove",
		"[project.finish]\ndelete_branch = true\n",
	);
	await commitFile({
		content: "cleanup\n",
		message: "cleanup work",
		path: "cleanup-refusal.txt",
		repo: worktreePath,
	});
	const originalHead = await gitOut(root, "rev-parse", "HEAD");

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(originalHead);
	expect(await gitSucceeds(root, "show", "HEAD:cleanup-refusal.txt")).toBe(false);
	expect(await pathExists(worktreePath)).toBe(true);
	expect(
		await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/delete-without-remove"),
	).toBe(true);
});
