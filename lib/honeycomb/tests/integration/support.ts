import { createLiveDeps } from "../../src/cli.ts";
import { afterAll } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LiveGitRunner } from "../../src/git/executor";
import { type Deps, LiveHookRunner, PickerCancelled } from "../../src/index";

const savedEnv = new Map<string, string | undefined>();

export const setTestEnv = (name: string, value: string): void => {
	if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
	process.env[name] = value;
};

export const restoreTestEnv = (): void => {
	for (const [name, value] of savedEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	savedEnv.clear();
};

export const deps: Deps = {
	...createLiveDeps(),
	internalRollback: false,
	git: new LiveGitRunner(),
	hooks: { runInline: async () => undefined, runCommand: new LiveHookRunner().runCommand },
	picker: {
		pick: async () => ({ key: "", display: "", preview: "" }),
		confirm: async () => true,
	},
	progress: {
		banner: () => undefined,
		stream: () => undefined,
		error: () => undefined,
	},
};

export class TestPicker {
	items: { key: string; display: string; preview: string }[] = [];
	confirmCalls = 0;
	private choice: string | null;
	private confirmed: boolean;

	constructor(choice: string | null, confirmed: boolean) {
		this.choice = choice;
		this.confirmed = confirmed;
	}

	async pick(items: { key: string; display: string; preview: string }[]) {
		this.items = items;
		if (this.choice === null) throw new PickerCancelled();
		const item = items.find((candidate) => candidate.key === this.choice);
		if (!item) throw new PickerCancelled();
		return item;
	}

	async confirm() {
		this.confirmCalls++;
		return this.confirmed;
	}
}

export function testDeps(overrides: Partial<Deps> = {}): Deps {
	return {
		...createLiveDeps(),
		internalRollback: false,
		git: new LiveGitRunner(),
		hooks: new LiveHookRunner(),
		picker: deps.picker,
		progress: deps.progress,
		...overrides,
	};
}

export function writeConfig(
	...args: [tmp: string, root: string, command: string, poolSize?: number, copyToml?: string]
) {
	const [tmp, root, command, poolSize, copyToml] = args;
	const configHome = join(tmp, "config");
	mkdirSync(configHome, { recursive: true });
	writeFileSync(
		join(configHome, "honeycomb.toml"),
		`[[project]]\nroot = "${root}"\ncommand = '''\n${command}\n'''\n${poolSize ? `pool_size = ${poolSize}\n` : ""}${copyToml ?? ""}`,
	);
	setTestEnv("XDG_CONFIG_HOME", configHome);
}

export const useOriginFixture = () => {
	let baseOriginFixture: { root: string; remote: string; tmp: string } | null = null;

	afterAll(() => {
		if (baseOriginFixture) rmSync(baseOriginFixture.tmp, { recursive: true, force: true });
	});

	const ensureBaseOriginFixture = async () => {
		if (baseOriginFixture) return baseOriginFixture;
		const tmp = mkdtempSync(join(tmpdir(), "honeycomb-origin-fixture-"));
		let root = join(tmp, "repo");
		await initRepo(root);
		root = realpathSync(root);
		const remote = join(tmp, "origin.git");
		await run(["git", "init", "--bare", remote]);
		await run(["git", "-C", root, "remote", "add", "origin", remote]);
		await run(["git", "-C", root, "push", "-u", "origin", "main"]);
		await run(["git", "-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
		await run(["git", "-C", root, "remote", "set-head", "origin", "-a"]);
		baseOriginFixture = { root, remote, tmp };
		return baseOriginFixture;
	};

	const initRepoWithOrigin = async (tmp: string) => {
		const fixture = await ensureBaseOriginFixture();
		let root = join(tmp, "repo");
		const remote = join(tmp, "origin.git");
		cpSync(fixture.root, root, { recursive: true });
		cpSync(fixture.remote, remote, { recursive: true });
		root = realpathSync(root);
		await run(["git", "-C", root, "remote", "set-url", "origin", remote]);
		return { root, remote };
	};

	return { initRepoWithOrigin };
};

export async function createPoolSlot(
	...args: [root: string, index: number, branch: string, initialized: boolean]
) {
	const [root, index, branch, initialized] = args;
	await run(["git", "-C", root, "branch", branch]);
	const slotPath = `${root}__feat${index}`;
	await run(["git", "-C", root, "worktree", "add", slotPath, branch]);
	if (initialized) {
		const marker = (
			await run(["git", "-C", slotPath, "rev-parse", "--git-path", "wk-pool-initialized"])
		).stdout.trim();
		writeFileSync(resolve(slotPath, marker), "");
	}
}

export async function createRemoteBranch(remote: string, branch: string) {
	const clone = mkdtempSync(join(tmpdir(), "honeycomb-remote-clone-"));
	try {
		await run(["git", "clone", remote, clone]);
		await run(["git", "-C", clone, "config", "user.email", "test@example.test"]);
		await run(["git", "-C", clone, "config", "user.name", "Test User"]);
		await run(["git", "-C", clone, "checkout", "-b", branch]);
		writeFileSync(join(clone, "remote.txt"), `${branch}\n`);
		await run(["git", "-C", clone, "add", "remote.txt"]);
		await run(["git", "-C", clone, "commit", "-m", `remote ${branch}`]);
		await run(["git", "-C", clone, "push", "origin", branch]);
	} finally {
		rmSync(clone, { recursive: true, force: true });
	}
}

export async function commitFile(change: {
	repo: string;
	path: string;
	content: string;
	message: string;
}) {
	writeFileSync(join(change.repo, change.path), change.content);
	await run(["git", "-C", change.repo, "add", change.path]);
	await run(["git", "-C", change.repo, "commit", "-m", change.message]);
}

export async function commitOnRemoteDefault(change: {
	remote: string;
	path: string;
	content: string;
	message: string;
}) {
	const clone = mkdtempSync(join(tmpdir(), "honeycomb-remote-default-"));
	try {
		await run(["git", "clone", change.remote, clone]);
		await run(["git", "-C", clone, "config", "user.email", "test@example.test"]);
		await run(["git", "-C", clone, "config", "user.name", "Test User"]);
		writeFileSync(join(clone, change.path), change.content);
		await run(["git", "-C", clone, "add", change.path]);
		await run(["git", "-C", clone, "commit", "-m", change.message]);
		await run(["git", "-C", clone, "push", "origin", "HEAD:main"]);
	} finally {
		rmSync(clone, { recursive: true, force: true });
	}
}

export async function initRepo(root: string) {
	mkdirSync(root, { recursive: true });
	await run(["git", "init", "-b", "main", root]);
	await run(["git", "-C", root, "config", "user.email", "test@example.test"]);
	await run(["git", "-C", root, "config", "user.name", "Test User"]);
	writeFileSync(join(root, "README.md"), "hello\n");
	await run(["git", "-C", root, "add", "README.md"]);
	await run(["git", "-C", root, "commit", "-m", "initial"]);
}

export async function run(cmd: string[]) {
	const result = await runRaw(cmd);
	if (result.exitCode !== 0)
		throw new Error(`${cmd.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
	return result;
}

export async function runRaw(cmd: string[]) {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}
