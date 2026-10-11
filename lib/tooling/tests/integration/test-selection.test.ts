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

test("Git discovery selects committed, staged, unstaged and untracked inputs with alternate changed references", async () => {
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
});

// eslint-disable-next-line max-statements -- Keep the bounded branch/index/worktree fixture together.
async function prepare(root: string): Promise<void> {
	await git(root, ["init", "--initial-branch=main", "--template="]);
	await git(root, ["config", "core.excludesFile", "/dev/null"]);
	await Bun.write(join(root, staged), "initial\n");
	await Bun.write(join(root, unstaged), "initial\n");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "initial"]);
	await git(root, ["branch", "alternate"]);
	await Bun.write(join(root, alternateInput), "# dependency input\n");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "main dependency input"]);
	await git(root, ["checkout", "-b", "feature"]);
	await Bun.write(join(root, committed), "branch input\n");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "branch adapter input"]);
	await git(root, ["checkout", "main"]);
	await Bun.write(join(root, "main-only.md"), "not part of feature changes\n");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-m", "divergent main"]);
	await git(root, ["checkout", "feature"]);
	await Bun.write(join(root, staged), "staged input\n");
	await git(root, ["add", staged]);
	await Bun.write(join(root, unstaged), "unstaged input\n");
	await Bun.write(join(root, untracked), "untracked input\n");
}

async function git(root: string, args: string[]): Promise<void> {
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
