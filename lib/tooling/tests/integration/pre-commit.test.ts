// eslint-disable-next-line import/no-nodejs-modules -- Disposable Git and hook fixtures.
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";

const hook = await Bun.file(new URL("../../../../.husky/pre-commit", import.meta.url)).text();
const executableMode = 0o755;
const success = 0;
const syncFailure = 7;

const run = async (argv: string[], cwd: string, env: Record<string, string | undefined>) => {
	const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stderr, stdout };
};

const environment = (root: string, exit: number) => ({
	...process.env,
	GIT_AUTHOR_EMAIL: "test@example.test",
	GIT_AUTHOR_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.test",
	GIT_COMMITTER_NAME: "Test",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	HOOK_LOG: join(root, "commands"),
	PATH: `${join(root, "bin")}:${process.env.PATH}`,
	SYNC_EXIT: String(exit),
});

const writeExecutable = async (path: string, content: string): Promise<void> => {
	await Bun.write(path, `#!/bin/sh\n${content}`);
	await chmod(path, executableMode);
};

const prepare = async (root: string, branch: string, env: ReturnType<typeof environment>) => {
	await mkdir(join(root, "bin"));
	await writeExecutable(join(root, "bin/bunx"), 'printf "lint\\n" >> "$HOOK_LOG"\n');
	await writeExecutable(
		join(root, "bin/bun"),
		`
printf '%s\\n' "$*" >> "$HOOK_LOG"
if [ "$*" = "run beads:sync" ]; then
	# Git sets index context for the outer commit. It must not reach tracker sync.
	for name in $(git rev-parse --local-env-vars); do
		if printenv "$name" >/dev/null; then
			echo "leaked Git environment: $name" >&2
			exit 9
		fi
	done
	exit "$SYNC_EXIT"
fi
`,
	);
	const initialized = await run(["git", "init", `--initial-branch=${branch}`], root, env);
	expect(initialized.exitCode).toBe(success);
	await writeExecutable(join(root, ".git/hooks/pre-commit"), hook);
};

test.each([
	{
		branch: "main",
		commands: ["lint", "run typecheck", "run beads:sync"],
		committed: true,
		exit: success,
	},
	{
		branch: "main",
		commands: ["lint", "run typecheck", "run beads:sync"],
		committed: false,
		exit: syncFailure,
	},
	{
		branch: "tracker/state",
		commands: ["lint", "run typecheck"],
		committed: true,
		exit: syncFailure,
	},
])(
	"commit checkpoint on $branch with sync exit $exit",
	async ({ branch, commands, committed, exit }) => {
		const root = await mkdtemp(join(tmpdir(), "hive commit hook "));
		const env = environment(root, exit);
		try {
			await prepare(root, branch, env);
			const result = await run(["git", "commit", "--allow-empty", "-m", "checkpoint"], root, env);
			expect(result.stderr).not.toContain("leaked Git environment");
			expect(result.exitCode === success).toBe(committed);
			const log = await Bun.file(env.HOOK_LOG).text();
			expect(log.trim().split("\n")).toEqual([...commands]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);
