import { EXIT_CODES, UsageError, dispatch } from "../../src/index";
import {
	commitFile,
	commitOnRemoteDefault,
	deps,
	pathExists,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, gitSucceeds, gitText, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { readFile } from "node:fs/promises";

const MERGE_COMMIT_AND_PARENTS = 3;
const COMMIT_AND_PARENT = 2;

const tmp = useTmpHome("honeycomb-finish-strategies-test-");
const { initRepoWithOrigin } = useOriginFixture();

const prepareFinish = async (branch: string, policy = "") => {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", copyToml: policy, root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], deps);
	return { remote, root, worktreePath: `${root}__${branch.replaceAll("/", "--")}` };
};

const assertRebasedHistory = async (root: string, targetHead: string) => {
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(
		await gitOut(root, "rev-parse", "refs/heads/feature/rebase-finish"),
	);
	const parents = await gitOut(root, "rev-list", "--parents", "-n", "1", "HEAD");
	expect(parents.split(" ")).toHaveLength(COMMIT_AND_PARENT);
	expect(await gitOut(root, "rev-parse", "HEAD~1")).toBe(targetHead);
	expect(await readFile(join(root, "source-rebased.txt"), "utf8")).toBe("source\n");
};

const assertConflictPreserved = async ({
	result,
	root,
	sourceHead,
	targetHead,
	worktreePath,
}: {
	result: Awaited<ReturnType<typeof dispatch>>;
	root: string;
	sourceHead: string;
	targetHead: string;
	worktreePath: string;
}) => {
	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "conflict",
	});
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(targetHead);
	expect(await gitOut(root, "rev-parse", "refs/heads/feature/squash-conflict")).toBe(sourceHead);
	expect(await pathExists(worktreePath)).toBe(true);
};

test("merge_commit integrates source with an explicit merge commit", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/merge-finish",
		'[project.finish]\nstrategy = "merge_commit"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "merge-source.txt",
		repo: worktreePath,
	});

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "merge_commit" });
	expect(await gitOut(root, "log", "-1", "--format=%s")).toBe("chore: merge worktree");
	expect(await gitText(root, "log", "-1", "--format=%B")).toContain(
		"Source branch:\nfeature/merge-finish",
	);
	const parents = await gitOut(root, "rev-list", "--parents", "-n", "1", "HEAD");
	expect(parents.split(" ")).toHaveLength(MERGE_COMMIT_AND_PARENTS);
	expect(await readFile(join(root, "merge-source.txt"), "utf8")).toBe("source\n");
});
test("rebase_ff rebases source onto target then fast-forwards target", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/rebase-finish",
		'[project.finish]\nstrategy = "rebase_ff"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "source-rebased.txt",
		repo: worktreePath,
	});
	await commitFile({
		content: "target\n",
		message: "target work",
		path: "target-base.txt",
		repo: root,
	});
	const targetHead = await gitOut(root, "rev-parse", "HEAD");

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "rebase_ff" });
	await assertRebasedHistory(root, targetHead);
});
test("non-ff strategy conflict emits structured refusal", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/squash-conflict",
		'[project.finish]\nstrategy = "squash"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source change",
		path: "README.md",
		repo: worktreePath,
	});
	await commitFile({
		content: "target\n",
		message: "target change",
		path: "README.md",
		repo: root,
	});
	const targetHead = await gitOut(root, "rev-parse", "HEAD");
	const sourceHead = await gitOut(worktreePath, "rev-parse", "HEAD");

	const result = await dispatch(
		"finish",
		["--cwd", worktreePath, "--title", "chore: squash conflicting work", "--json"],
		deps,
	);

	await assertConflictPreserved({ result, root, sourceHead, targetHead, worktreePath });
});
test("finish rejects CLI policy overrides before fresh_canonical mutates target", async () => {
	const { remote, root, worktreePath } = await prepareFinish(
		"feature/cli-policy-override",
		'[project.add]\npolicy = "fresh_canonical"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "cli-policy-override.txt",
		repo: worktreePath,
	});
	await commitOnRemoteDefault({
		content: "remote\n",
		message: "remote work",
		path: "remote-before-usage.txt",
		remote,
	});
	const originalHead = await gitOut(root, "rev-parse", "HEAD");

	const { failure } = await dispatch(
		"finish",
		["--cwd", worktreePath, "--json", "--strategy", "ff_only"],
		deps,
	);
	expect(failure).toBeInstanceOf(UsageError);
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(originalHead);
});
test("configured finish strategy is not overridden by CLI", async () => {
	const { root, worktreePath } = await prepareFinish(
		"feature/configured-strategy",
		'[project.finish]\nstrategy = "squash"\n',
	);
	await commitFile({
		content: "configured\n",
		message: "configured work",
		path: "configured.txt",
		repo: worktreePath,
	});

	const result = await dispatch(
		"finish",
		["--cwd", worktreePath, "--title", "chore: configured squash", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ strategy: "squash" });
	expect(await gitOut(root, "log", "-1", "--format=%s")).toBe("chore: configured squash");
});
test("fresh_canonical conflict refuses without first fast-forwarding target", async () => {
	const { remote, root, worktreePath } = await prepareFinish(
		"feature/fresh-conflict",
		'[project.add]\npolicy = "fresh_canonical"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "source.txt",
		repo: worktreePath,
	});
	await commitOnRemoteDefault({
		content: "fresh\n",
		message: "fresh remote",
		path: "remote-fresh.txt",
		remote,
	});
	const originalHead = await gitOut(root, "rev-parse", "HEAD");

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "conflict",
	});
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(originalHead);
	expect(await gitSucceeds(root, "show", "HEAD:remote-fresh.txt")).toBe(false);
});
test("non-fast-forward ff_only refuses without target modification", async () => {
	const { root, worktreePath } = await prepareFinish("feature/divergent-finish");
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "source-only.txt",
		repo: worktreePath,
	});
	await commitFile({
		content: "target\n",
		message: "target work",
		path: "target-only.txt",
		repo: root,
	});
	const targetHead = await gitOut(root, "rev-parse", "HEAD");

	const result = await dispatch("finish", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.BLOCKED);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "conflict",
	});
	expect(await gitOut(root, "rev-parse", "HEAD")).toBe(targetHead);
});

test("fresh_canonical advances the target before squash integration", async () => {
	const { remote, root, worktreePath } = await prepareFinish(
		"feature/fresh-squash",
		'[project.add]\npolicy = "fresh_canonical"\n[project.finish]\nstrategy = "squash"\n',
	);
	await commitFile({
		content: "source\n",
		message: "source work",
		path: "source.txt",
		repo: worktreePath,
	});
	await commitOnRemoteDefault({
		content: "remote\n",
		message: "advance origin",
		path: "remote.txt",
		remote,
	});

	const result = await dispatch(
		"finish",
		["--cwd", worktreePath, "--title", "chore: fresh squash", "--json"],
		deps,
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await gitOut(root, "rev-parse", "HEAD^")).toBe(
		await gitOut(root, "rev-parse", "origin/main"),
	);
	expect(await readFile(join(root, "source.txt"), "utf8")).toBe("source\n");
});
