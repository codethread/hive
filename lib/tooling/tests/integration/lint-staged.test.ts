// eslint-disable-next-line import/no-nodejs-modules -- Disposable real Git and formatter fixtures.
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the installed dependency's public CLI export.
import { fileURLToPath } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";

const configuration = new URL("../../../../package.json", import.meta.url);
const executable = fileURLToPath(import.meta.resolve("lint-staged/bin"));
const executableMode = 0o755;
const success = 0;
const trackerFile = ".beads/issues.jsonl";

async function run(argv: string[], cwd: string, env: Record<string, string | undefined>) {
	const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stderr, stdout };
}

function environment(root: string) {
	return {
		...process.env,
		GIT_AUTHOR_EMAIL: "test@example.test",
		GIT_AUTHOR_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.test",
		GIT_COMMITTER_NAME: "Test",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		PATH: `${join(root, "bin")}:${process.env.PATH}`,
	};
}

async function git(args: string[], root: string, env: ReturnType<typeof environment>) {
	const result = await run(["git", ...args], root, env);
	expect(result).toMatchObject({ exitCode: success });
	return result.stdout;
}

// Keep the real Git partial-staging fixture and deterministic writer together.
// eslint-disable-next-line max-statements
async function prepare(root: string, env: ReturnType<typeof environment>) {
	await mkdir(join(root, "bin"));
	await mkdir(join(root, ".beads"));
	await Bun.write(join(root, "package.json"), Bun.file(configuration));
	const formatter = join(root, "bin", "oxfmt");
	await Bun.write(
		formatter,
		`#!/bin/sh
for file in "$@"; do
	case "$file" in
		*.jsonl)
			# Deterministically model a native export while formatting is in progress.
			printf '%s\\n' '{"generation":3}' > "$file"
			;;
	esac
done
`,
	);
	await chmod(formatter, executableMode);
	await git(["init", "--initial-branch=tracker/state"], root, env);
	await Bun.write(join(root, trackerFile), '{"generation":0}\n');
	await git(["add", "--", trackerFile], root, env);
	await git(["commit", "-m", "fixture"], root, env);
	await Bun.write(join(root, trackerFile), '{"generation":1}\n');
	await git(["add", "--", trackerFile], root, env);
	await Bun.write(join(root, trackerFile), '{"generation":2}\n');
}

test("staged tracker JSONL preserves the index and newer working content #test-278", async () => {
	const root = await mkdtemp(join(tmpdir(), "hive lint staged "));
	const env = environment(root);
	try {
		await prepare(root, env);
		const result = await run([process.execPath, executable], root, env);
		expect(result).toMatchObject({ exitCode: success });
		expect(await Bun.file(join(root, trackerFile)).text()).toBe('{"generation":2}\n');
		expect(await git(["show", `:${trackerFile}`], root, env)).toBe('{"generation":1}\n');
		expect(await git(["stash", "list"], root, env)).toBe("");
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
