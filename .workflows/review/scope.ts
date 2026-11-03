import { Glob } from "bun";
import { z } from "zod";

const ZERO = 0;
const text = z.string().nonempty();
export const changeSchema = z.object({
	status: z.enum(["A", "M", "D", "R", "C", "T", "U", "?", "current"]),
	path: text,
	previousPath: text.optional(),
});
const changes = z.array(changeSchema).nonempty();
export const scopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("files"), changes }),
	z.object({ kind: z.literal("worktree"), base: text, changes }),
	z.object({ kind: z.literal("commit"), head: text, changes }),
	z.object({ kind: z.literal("range"), base: text, head: text, changes }),
]);
const pathPatterns = z.array(text).default([]);
export const scopeRequestSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("files"), patterns: z.array(text).nonempty() }),
	z.object({ kind: z.literal("worktree"), base: text.optional(), patterns: pathPatterns }),
	z.object({ kind: z.literal("commit"), ref: text, patterns: pathPatterns }),
	z.object({
		kind: z.literal("range"),
		base: text,
		head: text,
		mergeBase: z.boolean().default(false),
		patterns: pathPatterns,
	}),
]);
export type Scope = z.infer<typeof scopeSchema>;
export type ScopeRequest = z.infer<typeof scopeRequestSchema>;
export type Change = z.infer<typeof changeSchema>;
export interface ReviewGit {
	/** Absolute checkout root containing the supplied directory. */
	root: () => Promise<string>;
	/** Resolve a user ref to one commit. */
	resolve: (ref: string) => Promise<string>;
	/** Current tracked and nonignored files, excluding deleted files. */
	files: () => Promise<string[]>;
	/** Nonignored untracked paths. */
	untracked: () => Promise<string[]>;
	/** Combined worktree or endpoint delta with rename paths. */
	diff: (base: string, head?: string) => Promise<Change[]>;
	/** One non-merge commit's delta; reject ambiguous merge commits. */
	commit: (head: string) => Promise<Change[]>;
	/** Unique merge base of resolved endpoints. */
	mergeBase: (base: string, head: string) => Promise<string>;
}
export class ReviewError extends Error {
	/** Stable machine-readable failure category. */
	readonly reason: string;
	constructor(reason: string, message: string) {
		super(message);
		this.name = "ReviewError";
		this.reason = reason;
	}
}

// eslint-disable-next-line max-statements -- Keep the four scope cases together.
export async function resolveScope(request: ScopeRequest, git: ReviewGit): Promise<Scope> {
	switch (request.kind) {
		case "files": {
			const current = await git.files();
			return {
				kind: "files",
				changes: select(
					current.map((path) => ({ status: "current", path })),
					request.patterns,
				),
			};
		}
		case "worktree": {
			const base = await git.resolve(request.base ?? "HEAD");
			const untrackedPaths = await git.untracked();
			const untracked: Change[] = untrackedPaths.map((path) => ({ status: "?", path }));
			return {
				kind: "worktree",
				base,
				changes: select([...(await git.diff(base)), ...untracked], request.patterns),
			};
		}
		case "commit": {
			const head = await git.resolve(request.ref);
			return { kind: "commit", head, changes: select(await git.commit(head), request.patterns) };
		}
		case "range": {
			const endpoint = await git.resolve(request.base);
			const head = await git.resolve(request.head);
			let base = endpoint;
			if (request.mergeBase) {
				base = await git.mergeBase(endpoint, head);
			}
			return {
				kind: "range",
				base,
				head,
				changes: select(await git.diff(base, head), request.patterns),
			};
		}
	}
}

export function scopePaths(scope: Scope): string[] {
	const paths = new Set<string>();
	for (const change of scope.changes) {
		paths.add(change.path);
		if (change.previousPath !== undefined) {
			paths.add(change.previousPath);
		}
	}
	return [...paths].toSorted();
}

export function scopeInstructions(scope: Scope): string {
	switch (scope.kind) {
		case "files": {
			return "Inspect whole current file contents, including unchanged lines.";
		}
		case "worktree": {
			return `Inspect the combined staged/unstaged diff against ${scope.base} and full selected untracked files.`;
		}
		case "commit": {
			return `Inspect only commit ${scope.head}'s delta; read surrounding context from that commit using git show.`;
		}
		case "range": {
			return (
				`Inspect the endpoint diff ${scope.base}..${scope.head}; read context at the head and ` +
				`deleted content at the base.`
			);
		}
	}
}

// --- Private functions ---

function select(candidates: Change[], patterns: string[]): Change[] {
	const matchers = patterns.map((pattern) => new Glob(pattern.replace(/^\.\//u, "")));
	const selected = candidates.filter(
		({ path, previousPath }) =>
			matchers.length === ZERO ||
			matchers.some(
				(glob) => glob.match(path) || (previousPath !== undefined && glob.match(previousPath)),
			),
	);
	if (selected.length === ZERO) {
		throw new ReviewError("empty_scope", "No files match the requested review scope.");
	}
	return selected;
}
