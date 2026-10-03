import { BlockedError, CanonicalRootError, HoneycombError, UsageError } from "../errors.ts";
import type { GitRunner, WorkspaceFiles } from "../services.ts";
import type { Worktree } from "../domain/worktree.ts";
import { parseWorktreeList } from "../git/worktrees.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- resolve cwd at the filesystem boundary
import { resolve } from "node:path";

const findRemoveTarget = (options: {
	cwd: string;
	files: WorkspaceFiles;
	selector: { branch: string | null; self: boolean };
	worktrees: Worktree[];
}): Worktree | undefined => {
	const { cwd, files, selector, worktrees } = options;
	if (selector.branch) {
		return worktrees.find((worktree) => worktree.branch === selector.branch);
	}
	return resolveWorktreeContainingPath(worktrees, cwd, files);
};

export const listWorktrees = async (git: GitRunner, cwd: string): Promise<Worktree[]> => {
	const result = await git.run(["-C", cwd, "worktree", "list", "--porcelain"]);
	return parseWorktreeList(result.stdout);
};

export const resolveCanonicalRoot = async (git: GitRunner, cwd: string): Promise<string> => {
	const worktrees = await listWorktrees(git, cwd);
	const canonical = worktrees.find((worktree) => worktree.canonical);
	if (!canonical) {
		throw new HoneycombError("couldn't determine canonical worktree");
	}
	return canonical.path;
};

export const resolveWorktreeContainingPath = (
	worktrees: Worktree[],
	cwd: string,
	files: WorkspaceFiles,
): Worktree | undefined => {
	const normalizedCwd = files.normalizePath(resolve(cwd));
	const [mostSpecific] = worktrees
		.filter((worktree) => pathContains(files.normalizePath(worktree.path), normalizedCwd))
		.toSorted((left, right) => right.path.length - left.path.length);
	return mostSpecific;
};

export const resolveRemoveTarget = (options: {
	/** Git's current worktree inventory. */
	worktrees: Worktree[];
	/** Protected canonical checkout. */
	canonicalRoot: string;
	/** Invoking directory for self-selection. */
	cwd: string;
	/** Requested branch or invoking worktree. */
	selector: { branch: string | null; self: boolean };
	/** Filesystem canonicalization boundary. */
	files: WorkspaceFiles;
}): Worktree => {
	const { worktrees, canonicalRoot, cwd, selector, files } = options;
	const target = findRemoveTarget({ cwd, files, selector, worktrees });
	if (!target) {
		if (selector.branch) {
			throw new BlockedError(`no worktree found for branch ${selector.branch}`);
		}
		throw new UsageError(`no worktree contains cwd: ${cwd}`);
	}
	if (files.normalizePath(target.path) === files.normalizePath(canonicalRoot)) {
		throw new CanonicalRootError("refusing to remove canonical root");
	}
	return target;
};

export const pathContains = (parent: string, child: string): boolean =>
	child === parent || child.startsWith(`${parent}/`);
