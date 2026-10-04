import { ConfigError, dispatch } from "../../src/index";
import { afterEach, beforeEach, expect, test } from "bun:test";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { basename, join } from "node:path";
import {
	deps,
	pathExists,
	restoreTestEnv,
	setTestEnv,
	useOriginFixture,
	writeConfig,
} from "./support.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import { homedir, tmpdir } from "node:os";
// oxlint-disable-next-line import/no-nodejs-modules -- Integration fixtures exercise real filesystem and process boundaries.
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";

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

test("symlink source files fail as config errors in copy mode", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, ".env.real"), "real\n");
	await symlink(".env.real", join(root, ".env.link"));
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/symlink-source", "--json"], deps);
	writeConfig({ command: "echo ready", copyToml: 'copy = [".env.link"]\n', root, tmp });

	const result = await dispatch(
		"copy",
		["--cwd", `${root}__feature--symlink-source`, "--json"],
		deps,
	);
	expect(result.failure).toBeInstanceOf(ConfigError);
});

async function initSymlinkSource() {
	const { root } = await initRepoWithOrigin(tmp);
	const externalTarget = join(tmp, "external.env");
	await writeFile(externalTarget, "external\n");
	await symlink(externalTarget, join(root, ".env"));
	writeConfig({
		command: "echo ready",
		copyToml: 'copy_mode_default = "symlink"\ncopy = [".env"]\n',
		root,
		tmp,
	});
	await dispatch("add", ["--cwd", root, "--branch", "feature/symlink-mode", "--json"], deps);
	const worktreePath = `${root}__feature--symlink-mode`;
	return { externalTarget, root, worktreePath };
}

test("symlink mode creates destination symlinks to resolved source targets", async () => {
	const { externalTarget, worktreePath } = await initSymlinkSource();

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);
	const destination = join(worktreePath, ".env");

	const destinationStat = await lstat(destination);
	expect(destinationStat.isSymbolicLink()).toBe(true);
	const resolvedTarget = await realpath(externalTarget);
	expect(await readlink(destination)).toBe(resolvedTarget);
	expect(await readFile(destination, "utf8")).toBe("external\n");
	expect(JSON.parse(result.stdout ?? "{}").copied).toEqual([
		{ from: resolvedTarget, to: ".env", type: "symlink" },
	]);
});

test("copy preflights all entries before replacing destinations", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, ".env"), "source\n");
	writeConfig({ command: "echo ready", root, tmp });
	await dispatch("add", ["--cwd", root, "--branch", "feature/preflight", "--json"], deps);
	writeConfig({ command: "echo ready", copyToml: 'copy = [".env", ".env.missing"]\n', root, tmp });
	const worktreePath = `${root}__feature--preflight`;
	await writeFile(join(worktreePath, ".env"), "do not replace\n");

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);
	expect(result.failure).toBeInstanceOf(ConfigError);

	expect(await readFile(join(worktreePath, ".env"), "utf8")).toBe("do not replace\n");
});

async function initObjectSources() {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, "root.env"), "root\n");
	const absoluteSource = join(tmp, "absolute.env");
	await writeFile(absoluteSource, "absolute\n");
	const homeRelative = `.wktree-test-${basename(tmp)}.env`;
	const homeSource = join(homedir(), homeRelative);
	await writeFile(homeSource, "home\n");
	return { absoluteSource, homeRelative, homeSource, root };
}

async function assertObjectContents(worktreePath: string) {
	expect(await readFile(join(worktreePath, "copied/root.env"), "utf8")).toBe("root\n");
	expect(await readFile(join(worktreePath, "copied/absolute.env"), "utf8")).toBe("absolute\n");
	expect(await readFile(join(worktreePath, "copied/home-again.env"), "utf8")).toBe("home\n");
}

function assertObjectPayload(
	payload: { copied: unknown; exclude_paths: unknown },
	sources: { root: string; absoluteSource: string; homeSource: string },
) {
	const { root, absoluteSource, homeSource } = sources;
	expect(payload.copied).toEqual([
		{ from: join(root, "root.env"), to: "copied/root.env", type: "file" },
		{ from: absoluteSource, to: "copied/absolute.env", type: "file" },
		{ from: homeSource, to: "copied/home.env", type: "file" },
		{ from: homeSource, to: "copied/home-again.env", type: "file" },
	]);
	expect(payload.exclude_paths).toEqual([
		"copied/absolute.env",
		"copied/home-again.env",
		"copied/home.env",
		"copied/root.env",
	]);
}

test("copies object file sources from root-relative, absolute, and home paths", async () => {
	const { root, absoluteSource, homeRelative, homeSource } = await initObjectSources();

	try {
		writeConfig({
			command: "echo ready",
			copyToml: `copy = [\n  { from = "root.env", to = "copied/root.env" },\n  { from = ${JSON.stringify(absoluteSource)}, to = "copied/absolute.env" },\n  { from = "~/${homeRelative}", to = ["copied/home.env", "copied/home-again.env"] },\n]\n`,
			root,
			tmp,
		});
		await dispatch("add", ["--cwd", root, "--branch", "feature/object-files", "--json"], deps);
		const worktreePath = `${root}__feature--object-files`;

		const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);
		const payload = JSON.parse(result.stdout ?? "{}");

		await assertObjectContents(worktreePath);
		assertObjectPayload(payload, { absoluteSource, homeSource, root });
	} finally {
		await rm(homeSource, { force: true });
	}
});

async function initDirectorySource() {
	const { root } = await initRepoWithOrigin(tmp);
	await mkdir(join(root, "skill-dir"));
	await writeFile(join(root, "skill-dir", "foo.ts"), "one\n");
	writeConfig({
		command: "echo ready",
		copyToml:
			'copy = [{ from = "skill-dir", to = [".claude/skills/skill-dir", ".pi/agents/skill-dir"] }]\n',
		root,
		tmp,
	});
	await dispatch("add", ["--cwd", root, "--branch", "feature/dir-copy", "--json"], deps);
	const worktreePath = `${root}__feature--dir-copy`;
	return { root, worktreePath };
}

test("copies directories to exact final destinations and removes stale files on rerun", async () => {
	const { root, worktreePath } = await initDirectorySource();

	await dispatch("copy", ["--cwd", worktreePath], deps);
	await writeFile(join(worktreePath, ".claude/skills/skill-dir", "stale.ts"), "stale\n");
	await rm(join(root, "skill-dir", "foo.ts"));
	await writeFile(join(root, "skill-dir", "bar.ts"), "two\n");

	const result = await dispatch("copy", ["--cwd", worktreePath, "--json"], deps);

	expect(await pathExists(join(worktreePath, ".claude/skills/skill-dir", "stale.ts"))).toBe(false);
	expect(await readFile(join(worktreePath, ".claude/skills/skill-dir", "bar.ts"), "utf8")).toBe(
		"two\n",
	);
	expect(await readFile(join(worktreePath, ".pi/agents/skill-dir", "bar.ts"), "utf8")).toBe(
		"two\n",
	);
	expect(JSON.parse(result.stdout ?? "{}").copied).toEqual([
		{ from: join(root, "skill-dir"), to: ".claude/skills/skill-dir", type: "directory" },
		{ from: join(root, "skill-dir"), to: ".pi/agents/skill-dir", type: "directory" },
	]);
});

test("env-var and glob-looking object sources are treated literally", async () => {
	const { root } = await initRepoWithOrigin(tmp);
	await writeFile(join(root, "$SECRET*.env"), "literal\n");
	writeConfig({
		command: "echo ready",
		copyToml: 'copy = [{ from = "$SECRET*.env", to = "literal.env" }]\n',
		root,
		tmp,
	});
	await dispatch("add", ["--cwd", root, "--branch", "feature/literal", "--json"], deps);

	await dispatch("copy", ["--cwd", `${root}__feature--literal`], deps);

	expect(await readFile(join(`${root}__feature--literal`, "literal.env"), "utf8")).toBe(
		"literal\n",
	);
});
