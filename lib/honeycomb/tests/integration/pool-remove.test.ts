import { DirtySlotError, EXIT_CODES, UnmergedBranchError, dispatch } from "../../src/index";
import {
	commitFile,
	commitOnRemoteDefault,
	createRemoteBranch,
	pathExists,
	run,
	testDeps,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, gitSucceeds, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { mkdir, writeFile } from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join } from "node:path";

const SINGLE_SLOT = 1;

const tmp = useTmpHome("honeycomb-recycle-test-");
const { initRepoWithOrigin } = useOriginFixture();

const setupPooledRoot = async (home: string, branch: string) => {
	const { remote, root } = await initRepoWithOrigin(home);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: home });
	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], testDeps());
	return { remote, root };
};

const setupIgnoredPooledRoot = async (home: string, branch: string) => {
	const { remote, root } = await initRepoWithOrigin(home);
	await commitFile({
		content: "node_modules/\n",
		message: "ignore modules",
		path: ".gitignore",
		repo: root,
	});
	await run(["git", "-C", root, "push", "origin", "main"]);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: home });
	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], testDeps());
	return { remote, root };
};

const dirtyPooledSlot = async (slot: string) => {
	await commitFile({
		content: "tracked\n",
		message: "local unmerged",
		path: "tracked.txt",
		repo: slot,
	});
	await writeFile(join(slot, "untracked.txt"), "untracked\n");
	await mkdir(join(slot, "node_modules"));
	await writeFile(join(slot, "node_modules", "keep.txt"), "keep\n");
};

const setupUpstreamBlockedBranch = async (home: string) => {
	const { remote, root } = await initRepoWithOrigin(home);
	await createRemoteBranch(remote, "feature/upstream-blocked");
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: home });
	await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/upstream-blocked", "--json"],
		testDeps(),
	);
	return { root };
};

test("safe pooled remove resets slot to placeholder with removed false", async () => {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	await createRemoteBranch(remote, "feature/safe");
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
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

	expect(await pathExists(`${root}__feat1`)).toBe(true);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/safe")).toBe(false);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "ready",
		removed: false,
		session: { name: "repo__feat1", path: `${root}__feat1` },
		worktree_path: `${root}__feat1`,
	});
});

test("recycles a clean squash-integrated slot and deletes its branch", async () => {
	const { remote, root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/squash", "--json"], testDeps());
	await commitFile({
		content: "work\n",
		message: "feature work",
		path: "work.txt",
		repo: `${root}__feat1`,
	});
	await commitOnRemoteDefault({
		content: "work\n",
		message: "squash feature",
		path: "work.txt",
		remote,
	});

	const result = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/squash", "--integrated-into", "origin/main", "--json"],
		testDeps(),
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/squash")).toBe(false);
});

test("keep-branch recycles a clean unmerged slot and preserves its branch", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("add", ["--cwd", root, "--branch", "feature/squash-merged", "--json"], testDeps());
	await commitFile({
		content: "work\n",
		message: "work",
		path: "work.txt",
		repo: `${root}__feat1`,
	});

	const result = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/squash-merged", "--keep-branch", "--json"],
		testDeps(),
	);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/squash-merged")).toBe(
		true,
	);
});

test("safe preflight blocks dirty slots and leaves branch untouched", async () => {
	const { root } = await setupPooledRoot(tmp.dir, "feature/dirty");
	await writeFile(join(`${root}__feat1`, "dirty.txt"), "dirty\n");

	const { failure } = await dispatch(
		"remove",
		["--cwd", `${root}__feat1`, "--self", "--keep-branch"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(DirtySlotError);

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/dirty");
	expect(await pathExists(join(`${root}__feat1`, "dirty.txt"))).toBe(true);
});

test("forced pooled remove discards tracked and untracked dirt but preserves gitignored node_modules", async () => {
	const { root } = await setupIgnoredPooledRoot(tmp.dir, "feature/force-recycle");
	await dirtyPooledSlot(`${root}__feat1`);

	await dispatch("remove", ["--cwd", `${root}__feat1`, "--self", "--force"], testDeps());

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await pathExists(join(`${root}__feat1`, "tracked.txt"))).toBe(false);
	expect(await pathExists(join(`${root}__feat1`, "untracked.txt"))).toBe(false);
	expect(await pathExists(join(`${root}__feat1`, "node_modules", "keep.txt"))).toBe(true);
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/force-recycle")).toBe(
		false,
	);
});

test("missing or unmerged upstream blocks safe pooled remove", async () => {
	const { root } = await setupUpstreamBlockedBranch(tmp.dir);
	const { failure: missingUpstream } = await dispatch(
		"remove",
		["--cwd", `${root}__feat1`, "--self"],
		testDeps(),
	);
	expect(missingUpstream).toBeInstanceOf(UnmergedBranchError);

	await run([
		"git",
		"-C",
		`${root}__feat1`,
		"branch",
		"--set-upstream-to",
		"origin/feature/upstream-blocked",
		"feature/upstream-blocked",
	]);
	await commitFile({
		content: "ahead\n",
		message: "ahead",
		path: "ahead.txt",
		repo: `${root}__feat1`,
	});

	const { failure: unmerged } = await dispatch(
		"remove",
		["--cwd", `${root}__feat1`, "--self"],
		testDeps(),
	);
	expect(unmerged).toBeInstanceOf(UnmergedBranchError);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe(
		"feature/upstream-blocked",
	);
});
