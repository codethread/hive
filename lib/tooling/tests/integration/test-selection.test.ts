import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable real Git fixture.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
import { readChangedPaths } from "../../src/test-git.ts";
import { selectTestRuns } from "../../src/test-selection.ts";
// eslint-disable-next-line import/no-nodejs-modules -- System temporary directory.
import { tmpdir } from "node:os";

const success = 0;
const committed = "lib/beads/src/native.ts";
const staged = "lib/beads/src/memory.ts";
const unstaged = "lib/beads/src/types.ts";
const untracked = "lib/beads/tests/contract/fixtures.ts";
const alternateInput = "bunfig.toml";
const expectedInputs = [committed, staged, unstaged, untracked].toSorted();

test(
	"Git discovery selects committed, staged, unstaged and untracked " +
		"inputs with alternate changed references #test-265",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "hive test selection "));
		try {
			await prepare(root);
			const changed = await readChangedPaths("main", root);
			expect(changed.toSorted()).toEqual(expectedInputs);
			expect(selectTestRuns("changed", changed).map((run) => run.suite)).toEqual([
				"ordinary",
				"contracts",
			]);
			const alternate = await readChangedPaths("alternate", root);
			expect(alternate.toSorted()).toEqual([...expectedInputs, alternateInput].toSorted());
			expect(selectTestRuns("changed", alternate).map((run) => run.suite)).toEqual([
				"ordinary",
				"contracts",
			]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
);

// eslint-disable-next-line max-statements -- Keep the bounded branch/index/worktree fixture together.
async function prepare(root: string): Promise<void> {
	await git(root, ["init", "--initial-branch=main", "--template="]);
	const config = join(root, ".git/config");
	await Bun.write(config, `${await Bun.file(config).text()}\n[core]\n\texcludesFile = /dev/null\n`);
	// Keep main divergent to catch endpoint diffs; alternate checks an older merge base.
	await git(
		root,
		["fast-import", "--quiet"],
		[
			"commit refs/heads/alternate",
			"mark :1",
			"committer Test <test@example.test> 1700000000 +0000",
			"data 7",
			"initial",
			`M 100644 inline ${staged}`,
			"data 8",
			"initial\n",
			`M 100644 inline ${unstaged}`,
			"data 8",
			"initial\n",
			"",
			"commit refs/heads/main",
			"mark :2",
			"committer Test <test@example.test> 1700000001 +0000",
			"data 21",
			"main dependency input",
			"from :1",
			`M 100644 inline ${alternateInput}`,
			"data 19",
			"# dependency input\n",
			"",
			"commit refs/heads/feature",
			"committer Test <test@example.test> 1700000002 +0000",
			"data 20",
			"branch adapter input",
			"from :2",
			`M 100644 inline ${committed}`,
			"data 13",
			"branch input\n",
			"",
			"commit refs/heads/main",
			"committer Test <test@example.test> 1700000003 +0000",
			"data 14",
			"divergent main",
			"from :2",
			"M 100644 inline main-only.md",
			"data 28",
			"not part of feature changes\n",
			"",
			"done\n",
		].join("\n"),
	);
	await git(root, ["checkout", "--force", "feature"]);
	await Bun.write(join(root, staged), "staged input\n");
	await git(root, ["add", staged]);
	await Bun.write(join(root, unstaged), "unstaged input\n");
	await Bun.write(join(root, untracked), "untracked input\n");
}

async function git(root: string, args: string[], input = ""): Promise<void> {
	const child = Bun.spawn(
		["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
		{
			cwd: root,
			env: {
				...process.env,
				GIT_AUTHOR_EMAIL: "test@example.test",
				GIT_AUTHOR_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.test",
				GIT_COMMITTER_NAME: "Test",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
			},
			stdin: new Blob([input]),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, stdout, stderr }).toMatchObject({
		exitCode: success,
	});
}
