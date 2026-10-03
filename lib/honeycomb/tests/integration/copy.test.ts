import { ConfigError, EXIT_CODES, dispatch } from "../../src/index";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	commitFile,
	deps,
	restoreTestEnv,
	run,
	setTestEnv,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { join } from "node:path";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { tmpdir } from "node:os";

const { initRepoWithOrigin } = useOriginFixture();

let tmp = "";

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "honeycomb-copy-test-"));
	setTestEnv("HOME", tmp);
	setTestEnv("GIT_CONFIG_NOSYSTEM", "1");
	setTestEnv("GIT_CONFIG_GLOBAL", join(tmp, "gitconfig"));
	setTestEnv("XDG_CONFIG_HOME", join(tmp, "config"));
});

afterEach(async () => {
	restoreTestEnv();
	await rm(tmp, { force: true, recursive: true });
});

test("reports ready JSON for a non-canonical worktree with no copy config", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/copy", "--json"], deps);
	const worktreePath = `${root}__feature--copy`;

	const nestedCwd = join(worktreePath, "nested", "dir");
	await mkdir(nestedCwd, { recursive: true });

	const result = await dispatch("copy", ["--cwd", nestedCwd, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(JSON.parse(result.stdout ?? "{}")).toEqual({
		copied: [],
		diagnostics: [],
		exclude_paths: [],
		kind: "ready",
		ok: true,
		root,
		setup_output: [],
		worktree_path: worktreePath,
	});
});

test("non-json copy prints a one-line summary to stderr", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/human-copy", "--json"], deps);
	const worktreePath = `${root}__feature--human-copy`;

	const result = await dispatch("copy", ["--cwd", worktreePath], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(result.stdout).toBeUndefined();
	expect(result.stderr).toBe(`honeycomb: copied 0 items into ${worktreePath}\n`);
});

test("local-only copy skips failing pre_remote_check", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, ".env"), "SECRET=copy\n");
	writeConfig({
		command: "echo ready",
		copyToml: 'pre_remote_check = "echo blocked >&2; exit 7"\ncopy = [".env"]\n',
		root,
		tmp,
	});
	await run(["git", "-C", root, "branch", "feature/local-copy"]);
	const worktreePath = `${root}__feature--local-copy`;
	await run(["git", "-C", root, "worktree", "add", worktreePath, "feature/local-copy"]);

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await readFile(join(worktreePath, ".env"), "utf8")).toBe("SECRET=copy\n");
});

test("refuses canonical root with JSON blocked payload", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	writeConfig({ command: "echo ready", root, tmp });

	const result = await dispatch("copy", ["--cwd", root, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({
		kind: "blocked",
		reason: "canonical_root",
	});
});

test("copies a root-relative file and reports copied JSON", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, ".env"), "SECRET=one\n");
	writeConfig({ command: "echo ready", copyToml: 'copy = [".env"]\n', root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/copy", "--json"], deps);
	const worktreePath = `${root}__feature--copy`;

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
	expect(await readFile(join(worktreePath, ".env"), "utf8")).toBe("SECRET=one\n");
	expect(JSON.parse(result.stdout ?? "{}")).toEqual({
		copied: [{ from: join(root, ".env"), to: ".env", type: "file" }],
		diagnostics: [],
		exclude_paths: [".env"],
		kind: "ready",
		ok: true,
		root,
		setup_output: [],
		worktree_path: worktreePath,
	});
});

test("rerunning copy replaces an untracked destination with current source", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, ".env"), "first\n");
	writeConfig({ command: "echo ready", copyToml: 'copy = [".env"]\n', root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/replace", "--json"], deps);
	const worktreePath = `${root}__feature--replace`;
	await dispatch("copy", ["--cwd", worktreePath], deps);
	await writeFile(join(root, ".env"), "second\n");
	await writeFile(join(worktreePath, ".env"), "local edit\n");

	await dispatch("copy", ["--cwd", worktreePath], deps);

	expect(await readFile(join(worktreePath, ".env"), "utf8")).toBe("second\n");
});

const initTrackedDestination = async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await commitFile({
		content: "source\n",
		message: "add tracked copy",
		path: "tracked-copy.txt",
		repo: root,
	});
	await run(["git", "-C", root, "push", "origin", "main"]);
	await writeFile(join(root, "tracked-copy.txt"), "new source\n");
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/tracked-copy", "--json"], deps);
	writeConfig({ command: "echo ready", copyToml: 'copy = ["tracked-copy.txt"]\n', root, tmp });
	const worktreePath = `${root}__feature--tracked-copy`;
	return { worktreePath };
};

test("tracked destination blocks with unsafe JSON and leaves file intact", async () => {
	const { worktreePath } = await initTrackedDestination();

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

	expect(result.exitCode).toBe(EXIT_CODES.UNSAFE);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchObject({ kind: "blocked", reason: "unsafe" });
	expect(await readFile(join(worktreePath, "tracked-copy.txt"), "utf8")).toBe("source\n");
});

test.each(["", "/tmp/abs", "~/secret", "../escape"])(
	"invalid copy string %p fails as a config error",
	async (path) => {
		const { root } = await initRepoWithOrigin(tmp);
		writeConfig({ command: "echo ready", root, tmp });
		await dispatch(
			"add",
			["--cwd", root, "--branch", `feature/invalid-${path.length}`, "--json"],
			deps,
		);
		writeConfig({
			command: "echo ready",
			copyToml: `copy = [${JSON.stringify(path)}]\n`,
			root,
			tmp,
		});

		const result = await dispatch(
			"copy",
			["--cwd", `${root}__feature--invalid-${path.length}`, "--json"],
			deps,
		);
		expect(result.failure).toBeInstanceOf(ConfigError);
	},
);

test("missing source fails as a config error payload", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/missing-copy", "--json"], deps);
	writeConfig({ command: "echo ready", copyToml: 'copy = [".env.missing"]\n', root, tmp });

	const result = await dispatch(
		"copy",
		["--cwd", `${root}__feature--missing-copy`, "--json"],
		deps,
	);

	expect(result.failure).toBeInstanceOf(ConfigError);
	expect(JSON.parse(result.stdout ?? "{}")).toMatchInlineSnapshot(`
	  {
	    "diagnostics": [],
	    "kind": "error",
	    "message": "copy source does not exist: .env.missing",
	    "ok": false,
	    "reason": "config",
	    "setup_output": [],
	  }
	`);
});
