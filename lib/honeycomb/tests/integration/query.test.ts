import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, dispatch, EXIT_CODES } from "../../src/index";
import { setTestEnv, restoreTestEnv, deps, useOriginFixture, initRepo, run } from "./support.ts";

const { initRepoWithOrigin } = useOriginFixture();

describe("honeycomb read-only commands", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "honeycomb-test-"));
		setTestEnv("HOME", tmp);
		setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
		setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
		setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
	});

	afterEach(() => {
		restoreTestEnv();
		rmSync(tmp, { recursive: true, force: true });
	});

	test("root, list, json list, and non-pool path against a real repo", async () => {
		let root = join(tmp, "repo");
		await initRepo(root);
		root = realpathSync(root);
		const configHome = join(tmp, "config");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`[[project]]\nroot = "${root}"\ncommand = "echo ready"\n`,
		);
		setTestEnv("XDG_CONFIG_HOME", configHome);

		const rootResult = await dispatch("root", ["--cwd", root], deps);
		expect(rootResult.stdout).toBe(`${root}\n`);

		const listResult = await dispatch("list", ["--cwd", root], deps);
		expect(listResult.stdout).toContain(`${root}  `);
		expect(listResult.stdout).toContain("[main]");
		expect(listResult.stdout).toContain("[canonical]");

		const jsonResult = await dispatch("list", ["--cwd", root, "--json"], deps);
		const parsed = JSON.parse(jsonResult.stdout ?? "[]");
		expect(parsed[0]).toMatchObject({
			path: root,
			branch: "main",
			branch_ref: "refs/heads/main",
			locked: false,
			prunable: false,
			canonical: true,
			pool: null,
		});
		expect(parsed[0].branchRef).toBeUndefined();

		const pathResult = await dispatch("path", ["--cwd", root, "--branch", "feature/cool"], deps);
		expect(pathResult.stdout).toBe(`${root}__feature--cool\n`);
	});

	test("config explain reports effective policy JSON", async () => {
		let root = join(tmp, "repo");
		await initRepo(root);
		root = realpathSync(root);
		const configHome = join(tmp, "config-explain");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`[defaults.finish]\nstrategy = "rebase_ff"\n\n[[rule]]\nroot_glob = "${realpathSync(tmp)}/**"\n[rule.add]\npolicy = "fresh_canonical"\n[rule.finish]\npush = true\n\n[[project]]\nname = "repo"\nroot = "${root}"\n[project.finish]\ndelete_branch = true\n`,
		);
		setTestEnv("XDG_CONFIG_HOME", configHome);

		const result = await dispatch("config", ["explain", "--cwd", root, "--json"], deps);
		const payload = JSON.parse(result.stdout ?? "{}");

		expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
		expect(payload).toEqual({
			kind: "config_explain",
			root,
			matched_rules: [{ root_glob: `${realpathSync(tmp)}/**` }],
			project: { name: "repo", root },
			command: { source: null, value: null },
			pre_remote_check: { source: null, value: null },
			worktree_location: "sibling",
			add: { policy: "fresh_canonical" },
			finish: {
				enabled: true,
				strategy: "rebase_ff",
				push: true,
				remove_worktree: false,
				delete_branch: true,
			},
		});
	});

	test("list fails fast on malformed config", async () => {
		let root = join(tmp, "repo");
		await initRepo(root);
		root = realpathSync(root);
		const configHome = join(tmp, "config");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(join(configHome, "honeycomb.toml"), "[[project]]\nroot = ");
		setTestEnv("XDG_CONFIG_HOME", configHome);

		await expect(dispatch("list", ["--cwd", root], deps)).rejects.toThrow(ConfigError);
	});

	test("list annotates pool slots and path refuses pooled repos before slot state exists", async () => {
		const configRoot = join(tmp, "repo");
		const { root } = await initRepoWithOrigin(tmp);
		await run(["git", "-C", root, "branch", "wk-pool/feat1"]);
		await run(["git", "-C", root, "worktree", "add", `${root}__feat1`, "wk-pool/feat1"]);
		await run(["git", "-C", root, "worktree", "lock", "--reason", "keep slot", `${root}__feat1`]);
		const configHome = join(tmp, "config");
		mkdirSync(configHome, { recursive: true });
		writeFileSync(
			join(configHome, "honeycomb.toml"),
			`[[project]]\nroot = "${configRoot}"\ncommand = "echo ready"\npool_size = 1\n`,
		);
		setTestEnv("XDG_CONFIG_HOME", configHome);

		const listResult = await dispatch("list", ["--cwd", root], deps);
		expect(listResult.stdout).toContain("[pool:free]");
		const jsonResult = await dispatch("list", ["--cwd", root, "--json"], deps);
		const json = JSON.parse(jsonResult.stdout ?? "[]");
		expect(json[1]).toMatchObject({ locked: true, lock_reason: "keep slot" });

		await expect(
			dispatch("path", ["--cwd", root, "--branch", "feature/cool"], deps),
		).rejects.toThrow("no pooled worktree");
	});
});
