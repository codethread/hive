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
		BUN_EXECUTABLE: process.execPath,
	};
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await Bun.write(path, `#!/bin/sh\n${content}`);
	await chmod(path, executableMode);
}

async function prepare(root: string, branch: string, env: ReturnType<typeof environment>) {
	await mkdir(join(root, "bin"));
	await writeExecutable(
		join(root, "bin/bunx"),
		'printf "lint\\n" >> "$HOOK_LOG"\nexit "$LINT_EXIT"\n',
	);
	await writeExecutable(
		join(root, "bin/bun"),
		`printf '%s\\n' "$*" >> "$HOOK_LOG"
if [ "$2" = "scripts/beads-validate.ts" ]; then
	exec "$BUN_EXECUTABLE" "$@"
fi
exit "$TYPECHECK_EXIT"
`,
	);
	const initialized = await run(["git", "init", `--initial-branch=${branch}`], root, env);
	expect(initialized.exitCode).toBe(success);
	await writeExecutable(join(root, ".git/hooks/pre-commit"), hook);
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
	"commit quality gates on $branch with lint=$lintExit and typecheck=$typecheckExit",
	async ({ branch, commands, lintExit, typecheckExit }) => {
		const root = await mkdtemp(join(tmpdir(), "hive commit hook "));
		const env = environment(root, lintExit, typecheckExit);
		try {
			await prepare(root, branch, env);
			const result = await run(["git", "commit", "-m", "checkpoint"], root, env);
			expect(result.exitCode === success).toBe(lintExit === success && typecheckExit === success);
			const log = await Bun.file(env.HOOK_LOG).text();
			expect(log.trim().split("\n")).toEqual([...commands]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);

test.each([
	{
		name: "malformed staged snapshot",
		branch: "tracker/state",
		snapshot: "{broken\n",
		mixed: false,
		accepted: false,
		commands: ["run scripts/beads-validate.ts"],
	},
	{
		name: "duplicate IDs",
		branch: "tracker/state",
		snapshot: '{"id":"hv-test"}\n{"id":"hv-test"}\n',
		mixed: false,
		accepted: false,
		commands: ["run scripts/beads-validate.ts"],
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
])("artifact gates for $name", async ({ branch, snapshot, mixed, accepted, commands }) => {
	const root = await mkdtemp(join(tmpdir(), "hive snapshot hook "));
	const env = environment(root, success, qualityFailure);
	try {
		await prepare(root, branch, env);
		await stageSnapshot(root, env, { snapshot, mixed });
		const result = await run(["git", "commit", "-m", "checkpoint"], root, env);
		expect(result.exitCode === success).toBe(accepted);
		const log = await Bun.file(env.HOOK_LOG).text();
		expect(log.trim().split("\n")).toEqual([...commands]);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

async function stageSnapshot(
	root: string,
	env: ReturnType<typeof environment>,
	{ snapshot, mixed }: { snapshot: string; mixed: boolean },
): Promise<void> {
	await installValidator(root);
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

async function installValidator(root: string): Promise<void> {
	await mkdir(join(root, "scripts"));
	await Promise.all(
		["beads-validate.ts", "beads-jsonl.ts"].map((name) =>
			Bun.write(
				join(root, "scripts", name),
				Bun.file(new URL(`../../../../scripts/${name}`, import.meta.url)),
			),
		),
	);
}
