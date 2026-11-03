import type { Change, ReviewGit } from "./scope.ts";
import { ReviewError, changeSchema } from "./scope.ts";
import { z } from "zod";

const ZERO = 0;
const revision = z.string().regex(/^[a-f\d]{40,64}$/u);
const MAX_SINGLE_PARENT_FIELDS = 2;
export interface GitProcess {
	/** Shell-free command execution, preserving NUL-delimited output. */
	execute: (argv: string[], cwd: string) => Promise<string>;
}

export function liveReviewGit(repo: string, process: GitProcess): ReviewGit {
	const git = (...args: string[]) => process.execute(["git", ...args], repo);
	return {
		root: async () => {
			const output = await git("rev-parse", "--show-toplevel");
			return output.replace(/\n$/u, "");
		},
		resolve: async (ref) => {
			const output = await git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
			return revision.parse(output.trim());
		},
		files: async () => {
			const candidates = paths(
				await git("ls-files", "-z", "--cached", "--others", "--exclude-standard"),
			);
			const deleted = new Set(paths(await git("ls-files", "-z", "--deleted")));
			return [...new Set(candidates)].filter((path) => !deleted.has(path));
		},
		untracked: async () => paths(await git("ls-files", "-z", "--others", "--exclude-standard")),
		diff: async (base, head) =>
			parseChanges(
				await git(
					"diff",
					"--no-ext-diff",
					"--no-textconv",
					"--name-status",
					"-M",
					"-z",
					base,
					...optionalHead(head),
					"--",
				),
			),
		commit: async (head) => {
			const history = await git("rev-list", "--parents", "-n", "1", head);
			if (history.trim().split(" ").length > MAX_SINGLE_PARENT_FIELDS) {
				throw new ReviewError("merge_commit", "Select an explicit range for a merge commit.");
			}
			return parseChanges(
				await git(
					"diff-tree",
					"--root",
					"--no-commit-id",
					"--name-status",
					"-M",
					"-r",
					"-z",
					head,
					"--",
				),
			);
		},
		mergeBase: async (base, head) => {
			const output = await git("merge-base", "--all", base, head);
			return revision.parse(output.trim());
		},
	};
}

// --- Private functions ---

function paths(output: string): string[] {
	return output.split("\0").filter(Boolean);
}

function parseChanges(output: string): Change[] {
	const fields = paths(output);
	const changes: Change[] = [];
	while (fields.length > ZERO) {
		const status = fields.shift()!.charAt(ZERO);
		const firstPath = fields.shift();
		if (status === "R" || status === "C") {
			changes.push(changeSchema.parse({ status, previousPath: firstPath, path: fields.shift() }));
		} else {
			changes.push(changeSchema.parse({ status, path: firstPath }));
		}
	}
	return changes;
}

function optionalHead(head: string | undefined): string[] {
	if (head === undefined) {
		return [];
	}
	return [head];
}
