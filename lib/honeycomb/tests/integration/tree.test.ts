import { EXIT_CODES, dispatch } from "../../src/index.ts";
import { expect, test } from "bun:test";
import { gitOut, useTmpHome } from "./lifecycle-helpers.ts";
import { initRepo, testDeps } from "./support.ts";
import { GitError } from "../../src/git/error.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures use real checkout paths.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve macOS temporary-directory symlinks to Git's inventory paths.
import { realpath } from "node:fs/promises";

const home = useTmpHome("honeycomb-tree-");

async function initTreeRepo() {
	const root = join(home.dir, "repo");
	await initRepo(root);
	return realpath(root);
}

async function addBranch(root: string, branch: string, base: string) {
	const path = join(home.dir, branch);
	await gitOut(root, "worktree", "add", "-b", branch, path, base);
	return realpath(path);
}

async function commit(repo: string, message: string) {
	await gitOut(repo, "commit", "--allow-empty", "-m", message);
	return gitOut(repo, "rev-parse", "HEAD");
}

async function treeJson(root: string) {
	const result = await dispatch("tree", ["--cwd", root, "--json"], testDeps());
	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(result.stderr).toBeUndefined();
	return JSON.parse(result.stdout ?? "{}");
}

async function initOlderAndUnrelatedTree() {
	const root = await initTreeRepo();
	const old = await addBranch(root, "old", "main");
	const oldHead = await gitOut(old, "rev-parse", "HEAD");
	const mainHead = await commit(root, "advance main");
	const separate = await addBranch(root, "separate", "main");
	await gitOut(separate, "checkout", "--orphan", "independent");
	await commit(separate, "independent root");
	return { mainHead, oldHead, root };
}

test("older worktree commits can appear above canonical main; unrelated history stays separate", async () => {
	const { mainHead, oldHead, root } = await initOlderAndUnrelatedTree();
	const payload = await treeJson(root);
	expect(payload.nodes).toContainEqual(
		expect.objectContaining({
			id: mainHead,
			parentage: { head: oldHead, kind: "inferred" },
		}),
	);
	const result = await dispatch("tree", ["--cwd", root], testDeps());
	expect(result.stdout).toMatchInlineSnapshot(`
"Worktrees (inferred from Git ancestry; not creation history)
├── old [? parent unclear: no ancestor worktree]
│   └── main [canonical]
└── independent [? parent unclear: no ancestor worktree]
"
`);
});

test.each([
	{ args: ["init", "--bare"], kind: "bare" },
	{ args: ["init", "-b", "main"], kind: "unborn" },
])("$kind repositories have no comparable HEAD", async ({ args }) => {
	const root = join(home.dir, "empty");
	await gitOut(home.dir, ...args, root);
	const payload = await treeJson(root);
	expect(payload.nodes).toMatchObject([
		{ id: await realpath(root), parentage: { kind: "unknown", reason: "no_head" } },
	]);
	const text = await dispatch("tree", ["--cwd", root], testDeps());
	expect(text.stdout).toContain("[? no HEAD]");
});

test("detached worktrees are labelled by path and group with matching branch HEADs", async () => {
	const root = await initTreeRepo();
	const detached = join(home.dir, "detached");
	await gitOut(root, "worktree", "add", "--detach", detached, "HEAD");
	const path = await realpath(detached);
	const payload = await treeJson(root);
	expect(payload.nodes).toMatchObject([
		{ worktrees: [{ branch: "main" }, { detached: true, path }] },
	]);
	const text = await dispatch("tree", ["--cwd", root], testDeps());
	expect(text.stdout).toContain(`main [canonical] = ${path} [detached] [same HEAD]`);
});

test("ancestry query errors fail as git_failed instead of appearing as uncertain parents", async () => {
	const root = await initTreeRepo();
	const branch = await addBranch(root, "branch", "main");
	await commit(branch, "branch");
	const deps = testDeps();
	const result = await dispatch("tree", ["--cwd", root, "--json"], {
		...deps,
		git: {
			run: deps.git.run,
			runRaw: (args) => {
				expect(args).toContain("--no-lazy-fetch");
				return Promise.resolve({ exitCode: 128, stderr: "missing commit object", stdout: "" });
			},
		},
	});
	expect(result.exitCode).toBe(EXIT_CODES.FAILURE);
	expect(result.failure).toBeInstanceOf(GitError);
	expect(result.stderr).toBeUndefined();
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "error",
		ok: false,
		reason: "git_failed",
	});
});
