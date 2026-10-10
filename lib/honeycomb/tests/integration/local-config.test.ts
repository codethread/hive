import { expect, test } from "bun:test";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures use real filesystem boundaries.
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathExists, useOriginFixture } from "./support.ts";
import { runCli, useTmpHome } from "./lifecycle-helpers.ts";
import { EXIT_CODES } from "../../src/errors.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay within temporary repositories.
import { join } from "node:path";

const tmp = useTmpHome("honeycomb-local-config-");
const { initRepoWithOrigin } = useOriginFixture();
const CANONICAL_WORKTREE_COUNT = 1;

interface BootstrapRequest {
	/** Canonical fixture root. */
	root: string;
	/** Actual directory inherited by the CLI process. */
	cwd: string;
	/** New branch to create. */
	branch: string;
	/** Expected nested worktree path. */
	path: string;
}

async function writeGlobal(root: string) {
	const configHome = join(tmp.dir, "config");
	await mkdir(configHome, { recursive: true });
	await writeFile(
		join(configHome, "honeycomb.toml"),
		`[defaults.finish]
strategy = "squash"
push = true
[[rule]]
root_glob = "${root}/**"
command = "echo rule-bootstrap > rule.txt"
[[project]]
root = "${root}"
name = "global-name"
command = "echo global-bootstrap > global.txt"
copy_mode_default = "symlink"
copy = ["global-only"]
`,
	);
}

async function prepareLocalSetup() {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await writeGlobal(root);
	await writeFile(join(root, ".env"), "local-env\n");
	const command = String.raw`cat .env > bootstrap.env; printf "%s\n" "$WK_ROOT" "$WK_CREATED" > bootstrap.txt; echo local-bootstrap`;
	await writeFile(
		join(root, "honeycomb.toml"),
		`name = "local-name"
worktree_location = "nested"
command = '${command}'
pre_remote_check = "pwd > preflight.txt"
copy = [".env"]
[finish]
push = false
`,
	);
	return { command, root };
}

async function addAndAssertBootstrap(request: BootstrapRequest) {
	const { cwd, branch, root, path } = request;
	const added = await runCli(["add", "--branch", branch, "--json"], cwd);
	expect(added).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(JSON.parse(added.stdout)).toMatchObject({
		kind: "ready",
		ok: true,
		setup_output: expect.arrayContaining([{ line: "local-bootstrap", stream: "stdout" }]),
		worktree_path: path,
	});
	expect(await readFile(join(path, "bootstrap.txt"), "utf8")).toBe(`${root}\n${path}\n`);
	expect(await readFile(join(path, "bootstrap.env"), "utf8")).toBe("local-env\n");
	const envFile = await lstat(join(path, ".env"));
	expect(envFile.isSymbolicLink()).toBe(true);
	expect(await pathExists(join(path, "global.txt"))).toBe(false);
}

async function prepareFeatureCaller(first: string) {
	// A caller-worktree file must not replace the repository-wide canonical file.
	await writeFile(
		join(first, "honeycomb.toml"),
		'command = "exit 91"\nworktree_location = "sibling"',
	);
	const subdir = join(first, "src");
	await mkdir(subdir);
	return subdir;
}

async function assertLocalExplanation(root: string, subdir: string, command: string) {
	const canonicalExplain = await runCli(["config", "explain", "--json"], root);
	const featureExplain = await runCli(["config", "explain", "--json"], subdir);
	expect(featureExplain).toEqual(canonicalExplain);
	expect(JSON.parse(featureExplain.stdout)).toMatchObject({
		command: { source: `local:${root}/honeycomb.toml`, value: command },
		finish: { push: false, strategy: "squash" },
		local_config: { path: `${root}/honeycomb.toml`, settings: { finish: { push: false } } },
		pre_remote_check: { source: `local:${root}/honeycomb.toml`, value: "pwd > preflight.txt" },
		project: { name: "global-name", root },
		setup: { copy_mode_default: "symlink", name: "local-name" },
		worktree_location: "nested",
	});
	const textExplain = await runCli(["config", "explain"], subdir);
	expect(textExplain.stdout).toContain(`local_config: ${root}/honeycomb.toml`);
}

test("canonical local setup wins from canonical and feature worktrees through the real CLI", async () => {
	const { root, command } = await prepareLocalSetup();
	const first = join(root, ".worktrees", "feature--first");
	await addAndAssertBootstrap({ branch: "feature/first", cwd: root, path: first, root });
	const subdir = await prepareFeatureCaller(first);
	await assertLocalExplanation(root, subdir, command);
	await addAndAssertBootstrap({
		branch: "feature/second",
		cwd: subdir,
		path: join(root, ".worktrees", "feature--second"),
		root,
	});
	const preflight = await readFile(join(root, "preflight.txt"), "utf8");
	expect(preflight.trim()).toBe(root);
});

test("local-only configuration initializes a pool with real Bun bootstrap", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await writeFile(
		join(root, "honeycomb.toml"),
		'command = "bun --version > bun-version.txt"\npool_size = 1\nworktree_location = "nested"',
	);
	const ensured = await runCli(["ensure"], root);
	expect(ensured).toMatchObject({ exitCode: EXIT_CODES.SUCCESS });
	const slot = join(root, ".worktrees", "feat1");
	const version = await readFile(join(slot, "bun-version.txt"), "utf8");
	expect(version.trim()).toBe(Bun.version);
	await assertPoolState(root, slot);
});

async function assertPoolState(root: string, slot: string) {
	const status = await runCli(["status"], slot);
	expect(JSON.parse(status.stdout)).toMatchObject({
		hasPool: true,
		size: 1,
		slots: [{ initialized: true, path: slot }],
	});
	const explained = await runCli(["config", "explain", "--json"], slot);
	expect(JSON.parse(explained.stdout)).toMatchObject({
		command: { source: `local:${root}/honeycomb.toml` },
		// oxlint-disable-next-line unicorn/no-null -- Local-only settings must not invent a global exact-project source.
		project: null,
		setup: { pool_size: 1 },
	});
}

test("global-only setup and no-config worktree creation remain functional", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await writeGlobal(root);
	await writeFile(join(root, "global-only"), "global asset\n");
	const globalWorktree = `${root}__feature--global`;
	await assertGlobalBootstrap(root, globalWorktree);
	await rm(join(tmp.dir, "config", "honeycomb.toml"));
	const plain = await runCli(["add", "--branch", "feature/plain", "--json"], globalWorktree);
	expect(plain).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(JSON.parse(plain.stdout)).toMatchObject({
		setup_output: [],
		worktree_path: `${root}__feature--plain`,
	});
});

async function assertGlobalBootstrap(root: string, globalWorktree: string) {
	const added = await runCli(["add", "--branch", "feature/global", "--json"], root);
	expect(added).toMatchObject({ exitCode: EXIT_CODES.SUCCESS, stderr: "" });
	expect(await readFile(join(globalWorktree, "global.txt"), "utf8")).toBe("global-bootstrap\n");
	const copied = await lstat(join(globalWorktree, "global-only"));
	expect(copied.isSymbolicLink()).toBe(true);
	const explained = await runCli(["config", "explain", "--json"], globalWorktree);
	expect(JSON.parse(explained.stdout).command).toEqual({
		source: `project:${root}`,
		value: "echo global-bootstrap > global.txt",
	});
	expect(JSON.parse(explained.stdout).local_config).toBeUndefined();
}

test.each([
	{ name: "malformed TOML", toml: "command =" },
	{ name: "global selectors", toml: '[[project]]\nroot = "/repo"' },
	{ name: "missing effective command", toml: "pool_size = 1" },
])("invalid local $name fails before creating a worktree", async ({ toml }) => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await writeFile(join(root, "honeycomb.toml"), toml);
	const result = await runCli(["add", "--branch", "feature/invalid", "--json"], root);
	expect(result).toMatchObject({ exitCode: EXIT_CODES.USAGE, stderr: "" });
	expect(JSON.parse(result.stdout)).toMatchObject({
		message: expect.stringContaining(`${root}/honeycomb.toml`),
		ok: false,
		reason: "config",
	});
	const listed = await runCli(["list", "--json"], root);
	expect(JSON.parse(listed.stdout).worktrees).toHaveLength(CANONICAL_WORKTREE_COUNT);
});
