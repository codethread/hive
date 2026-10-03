import { ConfigError, HookError, ReservedPrefixError, dispatch } from "../../src/index";
import {
	createRemoteBranch,
	pathExists,
	run,
	setTestEnv,
	testDeps,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
import { expect, test } from "bun:test";
import { gitOut, gitSucceeds, gitText, useTmpHome } from "./lifecycle-helpers.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { join, resolve } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem IO.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const SINGLE_SLOT = 1;
const TWO_SLOTS = 2;
const FAIL_OUTSIDE_PLACEHOLDER = '[[ "$(git branch --show-current)" == wk-pool/* ]] || exit 7';

const tmp = useTmpHome("honeycomb-pool-add-test-");
const { initRepoWithOrigin } = useOriginFixture();

const prepareLegacyPool = async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	const configHome = join(tmp.dir, "config-mixed-pool");
	await mkdir(configHome, { recursive: true });
	setTestEnv("XDG_CONFIG_HOME", configHome);
	await writeFile(
		join(configHome, "honeycomb.toml"),
		`[[project]]\nroot = "${root}"\ncommand = "echo ready"\npool_size = 1\n`,
	);
	await dispatch("add", ["--cwd", root, "--branch", "feature/legacy-pool", "--json"], testDeps());

	return { configHome, root };
};

const prepareMixedPool = async () => {
	const { root, configHome } = await prepareLegacyPool();

	await writeFile(
		join(configHome, "honeycomb.toml"),
		`worktree_location = "sibling"\n\n[[project]]\nroot = "${root}"\ncommand = "echo ready"\npool_size = 2\nworktree_location = "nested"\n`,
	);
	const nestedSlot = join(root, ".worktrees", "feat2");
	await dispatch("ensure", ["--cwd", root], testDeps());

	return { legacySlot: `${root}__feat1`, nestedSlot, root };
};

const prepareRestoreTip = async () => {
	const { root, remote } = await initRepoWithOrigin(tmp.dir);
	await createRemoteBranch(remote, "feature/pool-restore-tip");
	await run(["git", "-C", root, "fetch", "origin"]);
	await run(["git", "-C", root, "branch", "feature/pool-restore-tip", "main"]);
	const originalHead = await gitOut(root, "rev-parse", "refs/heads/feature/pool-restore-tip");
	return { originalHead, root };
};

test("keeps legacy pool slots and creates only missing slots in the preferred location", async () => {
	const { root, legacySlot, nestedSlot } = await prepareMixedPool();
	const status = await dispatch("status", ["--cwd", root], testDeps());

	expect(
		JSON.parse(status.stdout ?? "{}").slots.map((slot: { path: string }) => slot.path),
	).toEqual([legacySlot, nestedSlot]);
	const path = await dispatch(
		"path",
		["--cwd", root, "--branch", "feature/legacy-pool"],
		testDeps(),
	);
	expect(path.stdout).toBe(`${legacySlot}\n`);
	expect(await pathExists(nestedSlot)).toBe(true);
	expect(await gitText(root, "status", "--porcelain")).toBe("");

	const removed = await dispatch(
		"remove",
		["--cwd", root, "--branch", "feature/legacy-pool", "--keep-branch", "--json"],
		testDeps(),
	);
	expect(JSON.parse(removed.stdout ?? "{}")).toMatchObject({
		removed: false,
		worktree_path: legacySlot,
	});
	expect(await gitOut(legacySlot, "branch", "--show-current")).toBe("wk-pool/feat1");
});
test("allocates the lowest initialized free slot and runs setup", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({
		command: 'git branch --show-current > "$(git rev-parse --git-path setup-branch)"',
		poolSize: TWO_SLOTS,
		root,
		tmp: tmp.dir,
	});
	await dispatch("ensure", ["--cwd", root], testDeps());

	const result = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/pooled", "--json"],
		testDeps(),
	);

	const plan = JSON.parse(result.stdout ?? "{}");
	expect(plan).toMatchObject({
		branch: "feature/pooled",
		created_new_branch: true,
		// oxlint-disable-next-line unicorn/no-null -- The JSON protocol explicitly reports absent script paths as null.
		post_create_script_path: null,
		worktree_path: `${root}__feat1`,
	});
	const setupBranchPath = await gitOut(`${root}__feat1`, "rev-parse", "--git-path", "setup-branch");
	expect(await readFile(resolve(`${root}__feat1`, setupBranchPath), "utf8")).toBe(
		"feature/pooled\n",
	);
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/pooled");
	expect(await gitOut(`${root}__feat2`, "branch", "--show-current")).toBe("wk-pool/feat2");
});
test("copies into allocated slot after checkout and before setup", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await writeFile(join(root, ".env"), "pooled\n");
	writeConfig({
		command: 'cat .env > "$WK_CREATED/allocated-read"',
		copyToml: 'copy = [".env"]\n',
		poolSize: SINGLE_SLOT,
		root,
		tmp: tmp.dir,
	});
	await dispatch("ensure", ["--cwd", root], testDeps());

	await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/allocated-copy", "--json"],
		testDeps(),
	);

	expect(await readFile(join(`${root}__feat1`, ".env"), "utf8")).toBe("pooled\n");
	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("feature/allocated-copy");
	expect(await readFile(join(`${root}__feat1`, "allocated-read"), "utf8")).toBe("pooled\n");
});
test("setup failure during allocation frees the slot and deletes the new branch", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: FAIL_OUTSIDE_PLACEHOLDER, poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("ensure", ["--cwd", root], testDeps());

	const { failure } = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/setup-fail", "--json"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(HookError);

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/setup-fail")).toBe(
		false,
	);
});
test("setup failure during allocation restores an existing branch tip", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await run(["git", "-C", root, "branch", "feature/pool-setup-restore"]);
	const originalHead = await gitOut(root, "rev-parse", "refs/heads/feature/pool-setup-restore");
	writeConfig({ command: FAIL_OUTSIDE_PLACEHOLDER, poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("ensure", ["--cwd", root], testDeps());

	const { failure } = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/pool-setup-restore", "--json"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(HookError);

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitOut(root, "rev-parse", "refs/heads/feature/pool-setup-restore")).toBe(
		originalHead,
	);
});
test("copy setup failure during allocation restores the slot placeholder", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("ensure", ["--cwd", root], testDeps());
	writeConfig({
		command: "echo should-not-run",
		copyToml: 'copy = [".env.missing"]\n',
		poolSize: SINGLE_SLOT,
		root,
		tmp: tmp.dir,
	});

	const { failure } = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/allocated-copy-fail", "--json"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(ConfigError);

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(
		await gitSucceeds(root, "show-ref", "--verify", "refs/heads/feature/allocated-copy-fail"),
	).toBe(false);
});
test("copy setup failure during allocation restores an existing branch tip", async () => {
	const { root, originalHead } = await prepareRestoreTip();
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });
	await dispatch("ensure", ["--cwd", root], testDeps());
	writeConfig({
		command: "echo should-not-run",
		copyToml: 'copy = [".env.missing"]\n',
		poolSize: SINGLE_SLOT,
		root,
		tmp: tmp.dir,
	});

	const { failure } = await dispatch(
		"add",
		["--cwd", root, "--branch", "feature/pool-restore-tip", "--json"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(ConfigError);

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe("wk-pool/feat1");
	expect(await gitOut(root, "rev-parse", "refs/heads/feature/pool-restore-tip")).toBe(originalHead);
});
test.each([
	{ branch: "feature/remote-pool", name: "existing remote-only", source: "remote" },
	{ branch: "feature/local-pool", name: "existing local", source: "local" },
])("allocates $name branch", async ({ branch, source }) => {
	const { root, remote } = await initRepoWithOrigin(tmp.dir);
	if (source === "remote") {
		await createRemoteBranch(remote, branch);
	}
	if (source === "local") {
		await run(["git", "-C", root, "branch", branch]);
	}
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });

	await dispatch("add", ["--cwd", root, "--branch", branch, "--json"], testDeps());

	expect(await gitOut(`${root}__feat1`, "branch", "--show-current")).toBe(branch);
});
test("rejects duplicate canonical branch and reserved branch before allocation", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	writeConfig({ command: "echo ready", poolSize: SINGLE_SLOT, root, tmp: tmp.dir });

	const duplicate = await dispatch(
		"add",
		["--cwd", root, "--branch", "main", "--json"],
		testDeps(),
	);
	expect(JSON.parse(duplicate.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		message: expect.stringContaining(root),
		reason: "duplicate_branch",
	});
	const { failure } = await dispatch(
		"add",
		["--cwd", root, "--branch", "wk-pool/feat9", "--json"],
		testDeps(),
	);
	expect(failure).toBeInstanceOf(ReservedPrefixError);
	expect(await pathExists(`${root}__feat1`)).toBe(false);
});
