/* eslint-disable import/no-nodejs-modules -- Real Git setup and cleanup belong to this measured contract. */
import { ReviewError, resolveScope } from "../../../../.workflows/review/scope.ts";
import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import type { Change } from "../../../../.workflows/review/scope.ts";
import { execute } from "@hive/shared";
import { join } from "node:path";
import { liveReviewGit } from "../../../../.workflows/review/git.ts";
import { tmpdir } from "node:os";

// eslint-disable-next-line max-statements -- One real history proves the consumed Git operations together.
test("review scopes preserve real Git history, rename paths and untracked files", async () => {
	const root = await mkdtemp(join(tmpdir(), "review-git-contract-"));
	const env = { ...process.env };
	delete env.GIT_INDEX_FILE;
	const gitProcess = { execute: (argv: string[], cwd: string) => execute(argv, cwd, env) };
	const git = (...args: string[]) => gitProcess.execute(["git", ...args], root);
	try {
		await git("init", "--quiet", "--initial-branch=main");
		await git("config", "user.name", "Contract test");
		await git("config", "user.email", "contract@example.invalid");
		await git("config", "core.hooksPath", "/dev/null");
		await Bun.write(join(root, "nested/inside.md"), "nested\n");
		await Bun.write(join(root, "unchanged.md"), "unchanged\n");
		await Bun.write(join(root, "old name.ts"), "export const retained = true;\n");
		await Bun.write(join(root, "deleted.ts"), "export const removed = true;\n");
		await git("add", "--all");
		await git("commit", "--quiet", "-m", "Initial contract files");
		const adapter = liveReviewGit(root, gitProcess);
		const base = await adapter.resolve("HEAD");
		expect(await liveReviewGit(join(root, "nested"), gitProcess).root()).toBe(await realpath(root));
		await git("mv", "--", "old name.ts", "new\nname.md");
		await git("rm", "--", "deleted.ts");
		await git("commit", "--quiet", "-m", "Rename and delete");
		await Bun.write(join(root, "untracked name.md"), "new file\n");
		const changes: Change[] = [
			{ status: "D", path: "deleted.ts" },
			{ status: "R", previousPath: "old name.ts", path: "new\nname.md" },
		];
		expect(await resolveScope({ kind: "worktree", base, patterns: [] }, adapter)).toEqual({
			kind: "worktree",
			base,
			changes: [...changes, { status: "?", path: "untracked name.md" }],
		});
		const commit = await resolveScope({ kind: "commit", ref: "HEAD", patterns: [] }, adapter);
		expect(commit.changes).toEqual(changes);
		const range = await resolveScope(
			{ kind: "range", base, head: "HEAD", mergeBase: true, patterns: [] },
			adapter,
		);
		expect(range).toMatchObject({ base, changes });
		const files = await resolveScope({ kind: "files", patterns: ["*.md"] }, adapter);
		expect(files.changes).toEqual([
			{ status: "current", path: "untracked name.md" },
			{ status: "current", path: "new\nname.md" },
			{ status: "current", path: "unchanged.md" },
		]);
		await expect(
			resolveScope({ kind: "files", patterns: ["absent/**"] }, adapter),
		).rejects.toBeInstanceOf(ReviewError);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
