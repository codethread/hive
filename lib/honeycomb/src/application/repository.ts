import {
	BlockedError,
	CanonicalRootError,
	EXIT_CODES,
	HoneycombError,
	UsageError,
} from "../errors.ts";
import type { GitRunner, WorkspaceFiles } from "../services.ts";
import type { Worktree, WorktreeTreeNode } from "../domain/worktree.ts";
import { buildWorktreeTree, worktreeCommit } from "../domain/worktree.ts";
import { GitError } from "../git/error.ts";
import { parseWorktreeList } from "../git/worktrees.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- resolve cwd at the filesystem boundary
import { resolve } from "node:path";

const GIT_NOT_ANCESTOR = 1;

export async function listWorktrees(git: GitRunner, cwd: string): Promise<Worktree[]> {
	const result = await git.run(["-C", cwd, "worktree", "list", "--porcelain"]);
	return parseWorktreeList(result.stdout);
}

/** Observe immutable HEADs once; never query moving branch refs or contact a remote. */
export async function readWorktreeTree(git: GitRunner, cwd: string): Promise<WorktreeTreeNode[]> {
	const worktrees = await listWorktrees(git, cwd);
	const heads = [
		...new Set(
			worktrees.map((worktree) => worktreeCommit(worktree)).filter((head) => head !== undefined),
		),
	];
	const ancestors = new Map<string, Set<string>>();
	for (const head of heads) {
		const candidates = new Set<string>();
		for (const candidate of heads.filter((other) => other !== head)) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- Bound Git subprocesses instead of spawning a quadratic number concurrently.
			if (await isAncestor({ ancestor: candidate, cwd, git, head })) {
				candidates.add(candidate);
			}
		}
		ancestors.set(head, candidates);
	}
	return buildWorktreeTree(worktrees, ancestors);
}

export async function resolveCanonicalRoot(git: GitRunner, cwd: string): Promise<string> {
	const worktrees = await listWorktrees(git, cwd);
	const canonical = worktrees.find((worktree) => worktree.canonical);
	if (!canonical) {
		throw new HoneycombError("couldn't determine canonical worktree");
	}
	return canonical.path;
}

export function resolveWorktreeContainingPath(
	worktrees: Worktree[],
	cwd: string,
	files: WorkspaceFiles,
): Worktree | undefined {
	const normalizedCwd = files.normalizePath(resolve(cwd));
	const [mostSpecific] = worktrees
		.filter((worktree) => pathContains(files.normalizePath(worktree.path), normalizedCwd))
		.toSorted((left, right) => right.path.length - left.path.length);
	return mostSpecific;
}

export function resolveRemoveTarget(options: {
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
}): Worktree {
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
}

export function pathContains(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}/`);
}
// --- Private functions ---

async function isAncestor(options: {
	/** Git process boundary. */
	git: GitRunner;
	/** Path inside the repository whose object database is queried. */
	cwd: string;
	/** Candidate ancestor's snapshotted commit OID. */
	ancestor: string;
	/** Descendant's snapshotted commit OID. */
	head: string;
}): Promise<boolean> {
	const { ancestor, cwd, git, head } = options;
	const args = ["--no-lazy-fetch", "-C", cwd, "merge-base", "--is-ancestor", ancestor, head];
	const result = await git.runRaw(args);
	if (result.exitCode !== EXIT_CODES.SUCCESS && result.exitCode !== GIT_NOT_ANCESTOR) {
		throw new GitError(args, result.stderr, result.exitCode);
	}
	return result.exitCode === EXIT_CODES.SUCCESS;
}

function findRemoveTarget(options: {
	cwd: string;
	files: WorkspaceFiles;
	selector: { branch: string | null; self: boolean };
	worktrees: Worktree[];
}): Worktree | undefined {
	const { cwd, files, selector, worktrees } = options;
	if (selector.branch) {
		return worktrees.find((worktree) => worktree.branch === selector.branch);
	}
	return resolveWorktreeContainingPath(worktrees, cwd, files);
}
