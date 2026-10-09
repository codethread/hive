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
		FORMATTER_LOG: join(root, "formatter.log"),
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

// eslint-disable-next-line max-statements -- Keep the real Git partial-staging fixture and deterministic writer together.
async function prepare(root: string, file: string, env: ReturnType<typeof environment>) {
	await mkdir(join(root, "bin"));
	await mkdir(join(root, ".beads"));
	await Bun.write(join(root, "package.json"), Bun.file(configuration));
	const formatter = `#!/bin/sh
printf '%s\\n' "$0" >> "$FORMATTER_LOG"
for file in "$@"; do
	case "$file" in
		*.jsonl)
			# Deterministically model a native export while formatting is in progress.
			printf '%s\\n' '{"generation":3}' > "$file"
			;;
	esac
done
`;
	for (const name of ["oxfmt", "oxlint"]) {
		const path = join(root, "bin", name);
		// eslint-disable-next-line no-await-in-loop -- Create two independent fixture executables.
		await Bun.write(path, formatter);
		// eslint-disable-next-line no-await-in-loop -- Make each fixture executable before invoking the CLI.
		await chmod(path, executableMode);
	}
	await git(["init", "--initial-branch=tracker/state"], root, env);
	await Bun.write(join(root, file), '{"generation":0}\n');
	await git(["add", "--", file], root, env);
	await git(["commit", "-m", "fixture"], root, env);
	await Bun.write(join(root, file), '{"generation":1}\n');
	await git(["add", "--", file], root, env);
	await Bun.write(join(root, file), '{"generation":2}\n');
}

test.each([
	{ file: ".beads/issues.jsonl", tools: [] },
	{ file: "notes.md", tools: ["oxfmt"] },
	{ file: "source.ts", tools: ["oxfmt", "oxfmt", "oxlint"] },
])(
	"staged $file preserves newer working content and runs only applicable tools",
	// eslint-disable-next-line max-statements -- One real CLI invocation verifies both index and working-tree preservation.
	async ({ file, tools }) => {
		const root = await mkdtemp(join(tmpdir(), "hive lint staged "));
		const env = environment(root);
		try {
			await prepare(root, file, env);
			const result = await run([process.execPath, executable], root, env);
			expect(result).toMatchObject({ exitCode: success });
			expect(await Bun.file(join(root, file)).text()).toBe('{"generation":2}\n');
			expect(await git(["show", `:${file}`], root, env)).toBe('{"generation":1}\n');
			const log = Bun.file(env.FORMATTER_LOG);
			let invoked: string[] = [];
			if (await log.exists()) {
				const text = await log.text();
				invoked = text.trim().split("\n");
			}
			expect(invoked.toSorted()).toEqual(tools.map((name) => join(root, "bin", name)).toSorted());
			expect(await git(["stash", "list"], root, env)).toBe("");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);
