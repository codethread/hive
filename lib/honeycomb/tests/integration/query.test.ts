import { BlockedError, ConfigError, EXIT_CODES, dispatch } from "../../src/index";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	deps,
	initRepo,
	restoreTestEnv,
	run,
	setTestEnv,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

const initQueryRepo = async () => {
	const root = join(tmp, "repo");
	await initRepo(root);
	return realpath(root);
};

const writeRawConfig = async (configHome: string, content: string) => {
	await mkdir(configHome, { recursive: true });
	await writeFile(join(configHome, "honeycomb.toml"), content);
	setTestEnv("XDG_CONFIG_HOME", configHome);
};

const assertCanonicalList = async (root: string) => {
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
};

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

test("list fails fast on malformed config", async () => {
	const root = await initQueryRepo();
	const configHome = join(tmp, "config");
	await mkdir(configHome, { recursive: true });
	await writeFile(join(configHome, "honeycomb.toml"), "[[project]]\nroot = ");
	setTestEnv("XDG_CONFIG_HOME", configHome);

	const { failure } = await dispatch("list", ["--cwd", root], deps);
	expect(failure).toBeInstanceOf(ConfigError);
});

const initLockedPool = async () => {
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
};

test("list annotates pool slots and path refuses pooled repos before slot state exists", async () => {
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
