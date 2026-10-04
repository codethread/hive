/* oxlint-disable-next-line import/no-nodejs-modules -- integration suites create real git worktrees and fixture files on disk */
import { access, cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
/* oxlint-disable-next-line import/no-nodejs-modules -- fixtures build paths inside their temporary roots */
import { join, resolve } from "node:path";
/* oxlint-disable-next-line import/no-nodejs-modules -- writeConfig stays synchronous, so it needs the sync fs entrypoint */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Deps } from "../../src/index";
import { EXIT_CODES } from "../../src/errors.ts";
import { afterAll } from "bun:test";
import { createLiveDeps } from "../../src/live-deps.ts";
import { createTestCdDirective } from "./fakes/test-cd-directive.ts";
import { createTestMultiplexer } from "./fakes/test-multiplexer.ts";
/* oxlint-disable-next-line import/no-nodejs-modules -- fixtures need the host temporary directory */
import { tmpdir } from "node:os";

const savedEnv = new Map<string, string | undefined>();
const liveDeps = createLiveDeps();

export const deps: Deps = {
	...liveDeps,
	cdDirective: createTestCdDirective(),
	hooks: { runCommand: liveDeps.hooks.runCommand, runInline: async () => {} },
	multiplexer: createTestMultiplexer(),
	picker: {
		confirm: () => Promise.resolve(true),
		pick: () => Promise.resolve({ display: "", key: "", preview: "" }),
	},
	progress: {
		banner: () => {},
		error: () => {},
		stream: () => {},
	},
};

interface OriginFixture {
	/** Bare Git repository used as the fixture's remote origin. */
	remote: string;
	/** Working repository with an origin remote configured. */
	root: string;
	/** Temporary directory containing the repositories. */
	tmp: string;
}

export function setTestEnv(name: string, value: string): void {
	if (!savedEnv.has(name)) {
		savedEnv.set(name, process.env[name]);
	}
	process.env[name] = value;
}

export function restoreTestEnv(): void {
	for (const [name, value] of savedEnv) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	savedEnv.clear();
}

/** Async existsSync replacement; Bun.file().exists() is false for directories. */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export function testDeps(overrides: Partial<Deps> = {}): Deps {
	return {
		...createLiveDeps(),
		cdDirective: createTestCdDirective(),
		multiplexer: createTestMultiplexer(),
		picker: deps.picker,
		progress: deps.progress,
		...overrides,
	};
}

export function writeConfig(options: {
	tmp: string;
	root: string;
	command: string;
	poolSize?: number;
	copyToml?: string;
}): void {
	const { tmp, root, command, poolSize, copyToml } = options;
	const configHome = join(tmp, "config");
	// oxlint-disable-next-line node/no-sync -- writeConfig stays synchronous so every integration suite can call it inline
	mkdirSync(configHome, { recursive: true });
	let poolLine = "";
	if (poolSize) {
		poolLine = `pool_size = ${poolSize}\n`;
	}
	// oxlint-disable-next-line node/no-sync -- writeConfig stays synchronous so every integration suite can call it inline
	writeFileSync(
		join(configHome, "honeycomb.toml"),
		`[[project]]\nroot = "${root}"\ncommand = '''\n${command}\n'''\n${poolLine}${copyToml ?? ""}`,
	);
	setTestEnv("XDG_CONFIG_HOME", configHome);
}

export function useOriginFixture() {
	const state: { base?: OriginFixture } = {};

	afterAll(async () => {
		if (state.base) {
			await rm(state.base.tmp, { force: true, recursive: true });
		}
	});

	const ensureBaseOriginFixture = async (): Promise<OriginFixture> => {
		state.base ??= await buildBaseOriginFixture();
		return state.base;
	};

	const initRepoWithOrigin = async (tmp: string) => {
		const fixture = await ensureBaseOriginFixture();
		const root = join(tmp, "repo");
		await cp(fixture.root, root, { recursive: true });
		const remote = join(tmp, "origin.git");
		await cp(fixture.remote, remote, { recursive: true });
		const resolvedRoot = await realpath(root);
		await run(["git", "-C", resolvedRoot, "remote", "set-url", "origin", remote]);
		return { remote, root: resolvedRoot };
	};

	return { initRepoWithOrigin };
}

export async function createPoolSlot(options: {
	root: string;
	index: number;
	branch: string;
	initialized: boolean;
}): Promise<void> {
	const { root, index, branch, initialized } = options;
	await run(["git", "-C", root, "branch", branch]);
	const slotPath = `${root}__feat${index}`;
	await run(["git", "-C", root, "worktree", "add", slotPath, branch]);
	if (initialized) {
		const result = await run([
			"git",
			"-C",
			slotPath,
			"rev-parse",
			"--git-path",
			"wk-pool-initialized",
		]);
		await writeFile(resolve(slotPath, result.stdout.trim()), "");
	}
}

export async function createRemoteBranch(remote: string, branch: string): Promise<void> {
	const clone = await mkdtemp(join(tmpdir(), "honeycomb-remote-clone-"));
	try {
		await run(["git", "clone", remote, clone]);
		await configureGitUser(clone);
		await run(["git", "-C", clone, "checkout", "-b", branch]);
		await writeFile(join(clone, "remote.txt"), `${branch}\n`);
		await run(["git", "-C", clone, "add", "remote.txt"]);
		await run(["git", "-C", clone, "commit", "-m", `remote ${branch}`]);
		await run(["git", "-C", clone, "push", "origin", branch]);
	} finally {
		await rm(clone, { force: true, recursive: true });
	}
}

export async function commitFile(change: {
	content: string;
	message: string;
	path: string;
	repo: string;
}): Promise<void> {
	await writeFile(join(change.repo, change.path), change.content);
	await run(["git", "-C", change.repo, "add", change.path]);
	await run(["git", "-C", change.repo, "commit", "-m", change.message]);
}

export async function commitOnRemoteDefault(change: {
	content: string;
	message: string;
	path: string;
	remote: string;
}): Promise<void> {
	const clone = await mkdtemp(join(tmpdir(), "honeycomb-remote-default-"));
	try {
		await run(["git", "clone", change.remote, clone]);
		await configureGitUser(clone);
		await writeFile(join(clone, change.path), change.content);
		await run(["git", "-C", clone, "add", change.path]);
		await run(["git", "-C", clone, "commit", "-m", change.message]);
		await run(["git", "-C", clone, "push", "origin", "HEAD:main"]);
	} finally {
		await rm(clone, { force: true, recursive: true });
	}
}

export async function initRepo(root: string): Promise<void> {
	await mkdir(root, { recursive: true });
	await run(["git", "init", "-b", "main", root]);
	await configureGitUser(root);
	await writeFile(join(root, "README.md"), "hello\n");
	await run(["git", "-C", root, "add", "README.md"]);
	await run(["git", "-C", root, "commit", "-m", "initial"]);
}

export async function run(cmd: string[]) {
	const result = await runRaw(cmd);
	if (result.exitCode !== EXIT_CODES.SUCCESS) {
		throw new Error(`${cmd.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
	}
	return result;
}

export async function runRaw(cmd: string[]) {
	const proc = Bun.spawn(cmd, { stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stderr, stdout };
}

// Private integration fixture and Git helpers.

async function configureGitUser(repo: string): Promise<void> {
	await run(["git", "-C", repo, "config", "user.email", "test@example.test"]);
	await run(["git", "-C", repo, "config", "user.name", "Test User"]);
}

async function buildBaseOriginFixture(): Promise<OriginFixture> {
	const tmp = await mkdtemp(join(tmpdir(), "honeycomb-origin-fixture-"));
	await initRepo(join(tmp, "repo"));
	const root = await realpath(join(tmp, "repo"));
	const remote = join(tmp, "origin.git");
	await run(["git", "init", "--bare", remote]);
	await run(["git", "-C", root, "remote", "add", "origin", remote]);
	await run(["git", "-C", root, "push", "-u", "origin", "main"]);
	await run(["git", "-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
	await run(["git", "-C", root, "remote", "set-head", "origin", "-a"]);
	return { remote, root, tmp };
}

export { createTestCdDirective } from "./fakes/test-cd-directive.ts";
export { createTestMultiplexer } from "./fakes/test-multiplexer.ts";
export { createTestPicker } from "./fakes/test-picker.ts";
export type { TestPicker } from "./fakes/test-picker.ts";
