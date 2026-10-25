// eslint-disable-next-line import/no-nodejs-modules -- Disposable Git and hook fixtures.
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";
import { validateStagedSnapshot } from "../../src/git/validate.ts";
import { validateTrackerHook } from "../../src/hooks.ts";

const applicationHook = "bunx lint-staged || exit $?\nbun run typecheck || exit $?\n";
const executableMode = 0o755;
const success = 0;
const qualityFailure = 7;

async function run(argv: string[], cwd: string, env: Record<string, string | undefined>) {
	const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stderr, stdout };
}

function environment(root: string, lintExit: number, typecheckExit: number) {
	return {
		...process.env,
		GIT_AUTHOR_EMAIL: "test@example.test",
		GIT_AUTHOR_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.test",
		GIT_COMMITTER_NAME: "Test",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		HOOK_LOG: join(root, "commands"),
		PATH: `${join(root, "bin")}:${process.env.PATH}`,
		LINT_EXIT: String(lintExit),
		TYPECHECK_EXIT: String(typecheckExit),
	};
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await Bun.write(path, `#!/bin/sh\n${content}`);
	await chmod(path, executableMode);
}

// eslint-disable-next-line max-statements -- Build one disposable repository with its executable hook adapters.
async function prepare(root: string, branch: string, env: ReturnType<typeof environment>) {
	await mkdir(join(root, "bin"));
	await writeExecutable(
		join(root, "bin/bunx"),
		`case "$0" in
*/bunx)
printf "lint\\n" >> "$HOOK_LOG"
exit "$LINT_EXIT"
;;
*/bun)
printf '%s\\n' "$*" >> "$HOOK_LOG"
exit "$TYPECHECK_EXIT"
;;
esac
`,
	);
	await symlink("bunx", join(root, "bin/bun"));

	await Bun.write(join(root, ".husky/pre-commit"), applicationHook);
	await Bun.write(env.HOOK_LOG, "");

	const initialized = await run(
		["git", "init", "--template=", `--initial-branch=${branch}`],
		root,
		env,
	);
	expect(initialized.exitCode).toBe(success);
	await Bun.write(join(root, "notes.md"), "First line  \nSecond line\n");
	const staged = await run(["git", "add", "notes.md"], root, env);
	expect(staged.exitCode).toBe(success);
}

test.each([
	{
		branch: "main",
		commands: ["lint", "run typecheck"],
		lintExit: success,
		typecheckExit: success,
	},
	{ branch: "main", commands: ["lint"], lintExit: qualityFailure, typecheckExit: success },
	{
		branch: "main",
		commands: ["lint", "run typecheck"],
		lintExit: success,
		typecheckExit: qualityFailure,
	},
	{
		branch: "tracker/state",
		commands: ["lint", "run typecheck"],
		lintExit: success,
		typecheckExit: success,
	},
])(
	"pre-commit quality gates on $branch with lint=$lintExit and typecheck=$typecheckExit #test-242",
	async ({ branch, commands, lintExit, typecheckExit }) => {
		const root = await mkdtemp(join(tmpdir(), "hive commit hook "));
		const env = environment(root, lintExit, typecheckExit);
		try {
			await prepare(root, branch, env);
			const result = await executeHook(root, env);
			expect(result.exitCode === success).toBe(lintExit === success && typecheckExit === success);
			const log = await Bun.file(env.HOOK_LOG).text();
			expect(log.trim().split("\n").filter(Boolean)).toEqual([...commands]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);

test.each([
	{
		name: "valid staged snapshot",
		branch: "tracker/state",
		snapshot: '{"id":"hv-test"}\n',
		mixed: false,
		accepted: true,
		commands: [],
	},
	{
		name: "malformed staged snapshot",
		branch: "tracker/state",
		snapshot: "{broken\n",
		mixed: false,
		accepted: false,
		commands: [],
	},
	{
		name: "snapshot with code",
		branch: "tracker/state",
		snapshot: '{"id":"hv-test"}\n',
		mixed: true,
		accepted: false,
		commands: ["lint", "run typecheck"],
	},
	{
		name: "snapshot on code branch",
		branch: "main",
		snapshot: '{"id":"hv-test"}\n',
		mixed: false,
		accepted: false,
		commands: ["lint", "run typecheck"],
	},
])(
	"artifact gates for $name #test-243",
	async ({ branch, snapshot, mixed, accepted, commands }) => {
		const root = await mkdtemp(join(tmpdir(), "hive snapshot hook "));
		const env = environment(root, success, qualityFailure);
		try {
			await prepare(root, branch, env);
			await stageSnapshot(root, env, { snapshot, mixed });
			const result = await executeHook(root, env);
			expect(result.exitCode === success).toBe(accepted);
			const log = await Bun.file(env.HOOK_LOG).text();
			expect(log.trim().split("\n").filter(Boolean)).toEqual([...commands]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);

async function stageSnapshot(
	root: string,
	env: ReturnType<typeof environment>,
	{ snapshot, mixed }: { snapshot: string; mixed: boolean },
): Promise<void> {
	if (!mixed) {
		const unstaged = await run(["git", "rm", "--cached", "notes.md"], root, env);
		expect(unstaged.exitCode).toBe(success);
	}
	await mkdir(join(root, ".beads"));
	await Bun.write(join(root, ".beads/issues.jsonl"), snapshot);
	const staged = await run(["git", "add", ".beads/issues.jsonl"], root, env);
	expect(staged.exitCode).toBe(success);
	// The live export must not replace validation of the staged commit artifact.
	await Bun.write(join(root, ".beads/issues.jsonl"), '{"id":"hv-live"}\n');
}

async function executeHook(root: string, env: ReturnType<typeof environment>) {
	const command = async (argv: readonly string[], cwd: string) => {
		const result = await run([...argv], cwd, env);
		if (result.exitCode !== success) {
			throw new Error(result.stderr || result.stdout || `Command exited ${result.exitCode}`);
		}
		return result.stdout.trim();
	};
	try {
		const snapshot = await validateTrackerHook(root, { command }, () =>
			validateStagedSnapshot(root, command),
		);
		if (!snapshot) {
			await command(["sh", "-e", join(root, ".husky/pre-commit")], root);
		}
		return { exitCode: success };
	} catch (error) {
		if (!(error instanceof Error)) {
			throw error;
		}
		return { exitCode: qualityFailure };
	}
}
