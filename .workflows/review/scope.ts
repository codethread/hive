import { Glob } from "bun";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const text = z.string().min(ONE);
const revision = z.string().regex(/^[a-f\d]{40,64}$/u);
const files = z.array(text).min(ONE);
export const scopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("files"), files }),
	z.object({ kind: z.literal("worktree"), base: revision, files, untracked: z.array(text) }),
	z.object({ kind: z.literal("commit"), head: revision, files }),
	z.object({ kind: z.literal("range"), base: revision, head: revision, files }),
]);
export type Scope = z.infer<typeof scopeSchema>;
export type ScopeRequest =
	| {
			/** Review full current file contents. */
			kind: "files";
			/** Repository-relative Bun globs selecting current files. */
			patterns: string[];
	  }
	| {
			/** Review staged, unstaged and untracked changes against HEAD. */
			kind: "worktree";
			/** Optional path filters; an empty list selects the whole diff. */
			patterns: string[];
	  }
	| {
			/** Review the delta introduced by one non-merge commit. */
			kind: "commit";
			/** Git ref resolved once to a commit, including HEAD or a SHA. */
			ref: string;
			/** Optional path filters within that commit's delta. */
			patterns: string[];
	  }
	| {
			/** Review an explicit endpoint or merge-base comparison. */
			kind: "range";
			/** Two supplied refs separated by .. or ... . */
			range: string;
			/** Optional path filters within the selected comparison. */
			patterns: string[];
	  };
export interface GitServices {
	/** Execute Git without a shell, preserving NUL-delimited output. */
	execute: (argv: string[], cwd: string) => Promise<string>;
}
type Git = (...args: string[]) => Promise<string>;
export class ReviewError extends Error {
	/** Stable CLI error category. */
	readonly reason: string;
	constructor(reason: string, message: string) {
		super(message);
		this.name = "ReviewError";
		this.reason = reason;
	}
}

/** Resolve scope only. The caller owns edits while reviewers use this checkout. */
export function resolveScope(
	request: ScopeRequest,
	repo: string,
	services: GitServices,
): Promise<Scope> {
	const git = (...args: string[]) => services.execute(["git", ...args], repo);
	switch (request.kind) {
		case "files": {
			return fileScope(git, request.patterns);
		}
		case "worktree": {
			return worktreeScope(git, request.patterns);
		}
		case "commit": {
			return commitScope(git, request.ref, request.patterns);
		}
		case "range": {
			return rangeScope(git, request.range, request.patterns);
		}
	}
}

export function scopeInstructions(scope: Scope): string {
	switch (scope.kind) {
		case "files": {
			return "Review the selected files' complete current contents, not just their diff.";
		}
		case "worktree": {
			return `Review the current tracked diff against ${scope.base} (staged and unstaged combined), plus the full contents of these selected untracked files: ${JSON.stringify(scope.untracked)}. Use git diff --no-ext-diff --no-textconv ${scope.base} -- <assigned paths>.`;
		}
		case "commit": {
			return `Review only the change introduced by commit ${scope.head}: git show --format= --no-ext-diff --no-textconv ${scope.head} -- <assigned paths>. Read surrounding code from that commit with git show ${scope.head}:<path>, not from the current checkout.`;
		}
		case "range": {
			return `Review the endpoint diff: git diff --no-ext-diff --no-textconv ${scope.base} ${scope.head} -- <assigned paths>. Read surrounding code from ${scope.head} (or removed code from ${scope.base}) with git show <revision>:<path>, not from the current checkout.`;
		}
	}
}

// --- Private functions ---

async function commitRef(git: Git, ref: string): Promise<string> {
	const output = await git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
	return revision.parse(output.trim());
}

async function fileScope(git: Git, patterns: string[]): Promise<Scope> {
	const candidates = paths(
		await git("ls-files", "-z", "--cached", "--others", "--exclude-standard"),
	);
	const deleted = new Set(paths(await git("ls-files", "-z", "--deleted")));
	return {
		files: select(
			candidates.filter((path) => !deleted.has(path)),
			patterns,
		),
		kind: "files",
	};
}

async function worktreeScope(git: Git, patterns: string[]): Promise<Scope> {
	const base = await commitRef(git, "HEAD");
	const untracked = paths(await git("ls-files", "-z", "--others", "--exclude-standard"));
	const changed = paths(await git("diff", "--name-only", "--no-renames", "-z", base, "--"));
	const selected = select([...changed, ...untracked], patterns);
	return {
		base,
		files: selected,
		kind: "worktree",
		untracked: untracked.filter((path) => selected.includes(path)),
	};
}

async function commitScope(git: Git, ref: string, patterns: string[]): Promise<Scope> {
	const head = await commitRef(git, ref);
	const history = await git("rev-list", "--parents", "-n", "1", head);
	if (history.trim().split(" ").length > TWO) {
		throw new ReviewError("merge_commit", "Choose an explicit range to review a merge commit.");
	}
	const changed = paths(
		await git(
			"diff-tree",
			"--root",
			"--no-commit-id",
			"--name-only",
			"--no-renames",
			"-r",
			"-z",
			head,
			"--",
		),
	);
	return { files: select(changed, patterns), head, kind: "commit" };
}

async function rangeScope(git: Git, range: string, patterns: string[]): Promise<Scope> {
	const match = /^(?<base>.+?)\.\.(?<merge>\.?)(?<head>.+)$/u.exec(range)?.groups;
	if (!match) {
		throw new ReviewError(
			"invalid_range",
			"Supply two explicit refs as BASE..HEAD or BASE...HEAD.",
		);
	}
	let base = await commitRef(git, match["base"]!);
	const head = await commitRef(git, match["head"]!);
	if (match["merge"] === ".") {
		const ancestor = await git("merge-base", "--all", base, head);
		base = revision.parse(ancestor.trim());
	}
	const changed = paths(await git("diff", "--name-only", "--no-renames", "-z", base, head, "--"));
	return { base, files: select(changed, patterns), head, kind: "range" };
}

function paths(output: string): string[] {
	return output.split("\0").filter(Boolean);
}

function select(candidates: string[], patterns: string[]): string[] {
	const matchers = patterns.map((pattern) => new Glob(pattern.replace(/^\.\//u, "")));
	const selected = [...new Set(candidates)]
		.filter((path) => matchers.length === ZERO || matchers.some((glob) => glob.match(path)))
		.toSorted();
	if (selected.length === ZERO) {
		throw new ReviewError("empty_scope", "No files match the requested review scope.");
	}
	return selected;
}
