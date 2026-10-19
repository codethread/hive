import { createWorktree, deps, useOriginFixture } from "./support.ts";
import { expect, test } from "bun:test";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures use real filesystem boundaries.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runCli, useTmpHome } from "./lifecycle-helpers.ts";
import type { CommandResult } from "../../src/index.ts";
import { EXIT_CODES } from "../../src/errors.ts";
import { dispatch } from "../../src/index.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay within temporary repositories.
import { join } from "node:path";

const tmp = useTmpHome("honeycomb-local-config-");
const { initRepoWithOrigin } = useOriginFixture();
const CANONICAL_WORKTREE_COUNT = 1;

// oxlint-disable-next-line eslint/max-statements -- Keep the real discovery fixture and its cwd assertions together.
test("canonical namespaced config wins from canonical, linked and nested cwd", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	const globalHome = join(tmp.dir, "config");
	await mkdir(globalHome);
	await writeFile(
		join(globalHome, "honeycomb.toml"),
		`[[project]]\nroot = "${root}"\ncommand = "echo global"`,
	);
	await writeFile(join(root, "honeycomb.toml"), "command =");
	const inherited = await dispatch("config", ["explain", "--cwd", root, "--json"], deps);
	expect(inherited.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(inherited.stdout ?? "{}")).toMatchObject({
		command: { source: `project:${root}`, value: "echo global" },
	});
	expect(JSON.parse(inherited.stdout ?? "{}")).not.toHaveProperty("local_config");
	const linked = join(tmp.dir, "linked");
	await createWorktree({ root, path: linked, branch: "feature/config" });
	await mkdir(join(root, ".hive"));
	await mkdir(join(root, "nested"));
	await mkdir(join(linked, ".hive"));
	await mkdir(join(linked, "nested"));
	await writeFile(join(root, ".hive", "honeycomb.toml"), 'command = "echo canonical"');
	await writeFile(join(linked, ".hive", "honeycomb.toml"), "command =");
	await writeFile(join(linked, "honeycomb.toml"), "command =");
	for (const cwd of [root, join(root, "nested"), linked]) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Exercise each cwd against the same canonical configuration.
		const result = await dispatch("config", ["explain", "--cwd", cwd, "--json"], deps);
		assertCanonicalConfig(result, root);
	}
	const native = await runCli(["config", "explain", "--json"], join(linked, "nested"));
	expect(native.stderr).toBe("");
	assertCanonicalConfig(native, root);
});

function assertCanonicalConfig(result: CommandResult, root: string) {
	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		ok: true,
		command: { source: `local:${root}/.hive/honeycomb.toml`, value: "echo canonical" },
		local_config: {
			path: `${root}/.hive/honeycomb.toml`,
			settings: { command: "echo canonical" },
		},
	});
}

test("local-only configuration initializes a pool with real Bun bootstrap #test-69", async () => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await mkdir(join(root, ".hive"));
	await writeFile(
		join(root, ".hive", "honeycomb.toml"),
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
		command: { source: `local:${root}/.hive/honeycomb.toml` },
		// oxlint-disable-next-line unicorn/no-null -- Local-only settings must not invent a global exact-project source.
		project: null,
		setup: { pool_size: 1 },
	});
}

test.each([
	{ name: "malformed TOML", toml: "command =" },
	{ name: "global selectors", toml: '[[project]]\nroot = "/repo"' },
	{ name: "missing effective command", toml: "pool_size = 1" },
])("invalid local $name fails before creating a worktree", async ({ toml }) => {
	const { root } = await initRepoWithOrigin(tmp.dir);
	await mkdir(join(root, ".hive"));
	await writeFile(join(root, ".hive", "honeycomb.toml"), toml);
	const result = await runCli(["add", "--branch", "feature/invalid", "--json"], root);
	expect(result).toMatchObject({ exitCode: EXIT_CODES.USAGE, stderr: "" });
	expect(JSON.parse(result.stdout)).toMatchObject({
		message: expect.stringContaining(`${root}/.hive/honeycomb.toml`),
		ok: false,
		reason: "config",
	});
	const listed = await runCli(["list", "--json"], root);
	expect(JSON.parse(listed.stdout).worktrees).toHaveLength(CANONICAL_WORKTREE_COUNT);
});
