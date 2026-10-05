import { BlockedError, EXIT_CODES, dispatch } from "../../src/index";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	createPoolSlot,
	deps,
	initRepo,
	pathExists,
	restoreTestEnv,
	run,
	setTestEnv,
	testDeps,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import type { CommandResult } from "../../src/protocol.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { tmpdir } from "node:os";

const { initRepoWithOrigin } = useOriginFixture();

let tmp = "";

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "honeycomb-test-"));
	setTestEnv("HOME", tmp);
	setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
	setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
	setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
});

afterEach(async () => {
	restoreTestEnv();
	await rm(tmp, { force: true, recursive: true });
});

async function initQueryRepo() {
	const root = join(tmp, "repo");
	await initRepo(root);
	return realpath(root);
}

async function writeRawConfig(configHome: string, content: string) {
	await mkdir(configHome, { recursive: true });
	await writeFile(join(configHome, "honeycomb.toml"), content);
	setTestEnv("XDG_CONFIG_HOME", configHome);
}

async function assertCanonicalList(root: string) {
	const listResult = await dispatch("list", ["--cwd", root], deps);
	expect(listResult.stdout).toContain(`${root}  `);
	expect(listResult.stdout).toContain("[main]");
	expect(listResult.stdout).toContain("[canonical]");

	const jsonResult = await dispatch("list", ["--cwd", root, "--json"], deps);
	const parsed = JSON.parse(jsonResult.stdout ?? "{}");
	const [canonical] = parsed.worktrees;
	expect(parsed).toMatchObject({ diagnostics: [], kind: "list", ok: true, setup_output: [] });
	expect(canonical).toMatchObject({
		branch: "main",
		branch_ref: "refs/heads/main",
		canonical: true,
		locked: false,
		path: root,
		// oxlint-disable-next-line unicorn/no-null -- Assert the explicit-null JSON protocol contract.
		pool: null,
		prunable: false,
	});
	expect(canonical.branchRef).toBeUndefined();
}

test("root, list, json list, and non-pool path against a real repo", async () => {
	const root = await initQueryRepo();
	writeConfig({ command: "echo ready", root, tmp });

	const rootResult = await dispatch("root", ["--cwd", root], deps);
	expect(rootResult.stdout).toBe(`${root}\n`);

	await assertCanonicalList(root);

	const pathResult = await dispatch("path", ["--cwd", root, "--branch", "feature/cool"], deps);
	expect(pathResult.stdout).toBe(`${root}__feature--cool\n`);
});

test("config explain reports effective policy JSON", async () => {
	const root = await initQueryRepo();
	const configHome = join(tmp, "config-explain");
	await writeRawConfig(
		configHome,
		`[defaults.finish]\nstrategy = "rebase_ff"\n\n[[rule]]\nroot_glob = "${await realpath(tmp)}/**"\n[rule.add]\npolicy = "fresh_canonical"\n[rule.finish]\npush = true\n\n[[project]]\nname = "repo"\nroot = "${root}"\n[project.finish]\ndelete_branch = true\n`,
	);

	const result = await dispatch("config", ["explain", "--cwd", root, "--json"], deps);
	const payload = JSON.parse(result.stdout ?? "{}");

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(payload).toEqual({
		add: { policy: "fresh_canonical" },
		// oxlint-disable-next-line unicorn/no-null -- Assert the explicit-null JSON protocol contract.
		command: { source: null, value: null },
		diagnostics: [],
		finish: {
			delete_branch: true,
			enabled: true,
			push: true,
			remove_worktree: false,
			strategy: "rebase_ff",
		},
		kind: "config_explain",
		matched_rules: [{ root_glob: `${await realpath(tmp)}/**` }],
		ok: true,
		// oxlint-disable-next-line unicorn/no-null -- Assert the explicit-null JSON protocol contract.
		pre_remote_check: { source: null, value: null },
		project: { name: "repo", root },
		root,
		setup_output: [],
		worktree_location: "sibling",
	});
});

test("list remains available with malformed config", async () => {
	const root = await initQueryRepo();
	await writeRawConfig(join(tmp, "config"), "[[project]]\nroot = ");

	await assertCanonicalList(root);
});

async function initIncompletePool() {
	const root = await initQueryRepo();
	writeConfig({
		command: "exit 9",
		copyToml: 'pre_remote_check = "exit 7"\ncopy = [".env.missing"]\n',
		poolSize: 3,
		root,
		tmp,
	});
	await createPoolSlot({ branch: "feature/ready", index: 1, initialized: true, root });
	await createPoolSlot({ branch: "wk-pool/feat2", index: 2, initialized: false, root });
	return root;
}

function assertPoolInventory(result: CommandResult, root: string, json: boolean) {
	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(result.stderr).toBeUndefined();
	expect(result.stdout).toContain(`${root}__feat1`);
	expect(result.stdout).toContain(`${root}__feat2`);
	expect(result.stdout).not.toContain(`${root}__feat3`);
	if (json) {
		expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
			diagnostics: [],
			kind: "list",
			ok: true,
			setup_output: [],
			worktrees: [
				{ canonical: true, path: root },
				{ branch: "feature/ready", pool: { index: 1, placeholder: false } },
				{ branch: "wk-pool/feat2", pool: { index: 2, placeholder: true } },
			],
		});
	}
}

test.each([
	{ args: [], format: "text" },
	{ args: ["--json"], format: "json" },
])(
	"$format list reads one inventory without preparing or scanning pool slots",
	async ({ args, format }) => {
		const root = await initIncompletePool();
		const liveDeps = testDeps();
		const calls: string[][] = [];
		function observeGit(gitArgs: string[]) {
			calls.push(gitArgs);
			return liveDeps.git.run(gitArgs);
		}

		const result = await dispatch("list", ["--cwd", root, ...args], {
			...liveDeps,
			git: { run: observeGit, runRaw: observeGit },
		});

		assertPoolInventory(result, root, format === "json");
		expect(calls).toEqual([["-C", root, "worktree", "list", "--porcelain"]]);
		expect(await pathExists(`${root}__feat3`)).toBe(false);
	},
);

async function initLockedPool() {
	const configRoot = join(tmp, "repo");
	const { root } = await initRepoWithOrigin(tmp);
	await run(["git", "-C", root, "branch", "wk-pool/feat1"]);
	await run(["git", "-C", root, "worktree", "add", `${root}__feat1`, "wk-pool/feat1"]);
	await run(["git", "-C", root, "worktree", "lock", "--reason", "keep slot", `${root}__feat1`]);
	const configHome = join(tmp, "config");
	await writeRawConfig(
		configHome,
		`[[project]]\nroot = "${configRoot}"\ncommand = "echo ready"\npool_size = 1\n`,
	);
	return root;
}

test("list annotates locked pool slots and path refuses an unallocated branch", async () => {
	const root = await initLockedPool();

	const listResult = await dispatch("list", ["--cwd", root], deps);
	expect(listResult.stdout).toContain("[pool:free]");
	const jsonResult = await dispatch("list", ["--cwd", root, "--json"], deps);
	const json = JSON.parse(jsonResult.stdout ?? "{}");
	const [, slot] = json.worktrees;
	expect(slot).toMatchObject({ lock_reason: "keep slot", locked: true });

	const { failure } = await dispatch("path", ["--cwd", root, "--branch", "feature/cool"], deps);
	expect(failure).toBeInstanceOf(BlockedError);
});
