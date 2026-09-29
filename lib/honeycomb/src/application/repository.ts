import { resolve } from "node:path";
import type { Worktree } from "../domain/worktree.ts";
import { BlockedError, CanonicalRootError, UsageError, HoneycombError } from "../errors.ts";
import { parseWorktreeList } from "../git/worktrees.ts";
import type { GitRunner, WorkspaceFiles } from "../services.ts";

export const listWorktrees = async (git: GitRunner, cwd: string): Promise<Worktree[]> => {
	const result = await git.run(["-C", cwd, "worktree", "list", "--porcelain"]);
	return parseWorktreeList(result.stdout);
};

export const resolveCanonicalRoot = async (git: GitRunner, cwd: string): Promise<string> => {
	const worktrees = await listWorktrees(git, cwd);
	const canonical = worktrees.find((worktree) => worktree.canonical);
	if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
	return canonical.path;
};

export const resolveWorktreeContainingPath = (
	worktrees: Worktree[],
	cwd: string,
	files: WorkspaceFiles,
): Worktree | undefined => {
	const normalizedCwd = files.normalizePath(resolve(cwd));
	return worktrees
		.filter((worktree) => pathContains(files.normalizePath(worktree.path), normalizedCwd))
		.sort((left, right) => right.path.length - left.path.length)[0];
};

export const resolveRemoveTarget = (
	worktrees: Worktree[],
	canonicalRoot: string,
	cwd: string,
	selector: { branch: string | null; self: boolean },
	files: WorkspaceFiles,
): Worktree => {
	const target = selector.branch
		? worktrees.find((worktree) => worktree.branch === selector.branch)
		: resolveWorktreeContainingPath(worktrees, cwd, files);
	if (!target) {
		if (selector.branch) throw new BlockedError(`no worktree found for branch ${selector.branch}`);
		throw new UsageError(`no worktree contains cwd: ${cwd}`);
	}
	if (files.normalizePath(target.path) === files.normalizePath(canonicalRoot))
		throw new CanonicalRootError("refusing to remove canonical root");
	return target;
};

export const pathContains = (parent: string, child: string): boolean =>
	child === parent || child.startsWith(`${parent}/`);
