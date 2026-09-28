// :module: Pure parsers for git worktree and branch command output

import type { Worktree } from "../domain/worktree.ts";

const parseRecord = (record: string, canonical: boolean): Worktree => {
	let path: string | null = null;
	let head: string | null = null;
	let branchRef: string | null = null;
	let detached = false;
	let bare = false;
	let locked = false;
	let lockReason: string | null = null;
	let prunable = false;
	let prunableReason: string | null = null;

	for (const line of record.split("\n")) {
		if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
		else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
		else if (line.startsWith("branch ")) branchRef = line.slice("branch ".length);
		else if (line === "detached") detached = true;
		else if (line === "bare") bare = true;
		else if (line === "locked") locked = true;
		else if (line.startsWith("locked ")) {
			locked = true;
			lockReason = line.slice("locked ".length);
		} else if (line === "prunable") prunable = true;
		else if (line.startsWith("prunable ")) {
			prunable = true;
			prunableReason = line.slice("prunable ".length);
		}
	}

	if (path === null) {
		throw new Error("git worktree porcelain record is missing worktree path");
	}

	const branch = branchRef?.startsWith("refs/heads/")
		? branchRef.slice("refs/heads/".length)
		: null;
	const slotMatch = path.match(/(?:__feat|[/\\]\.(?:worktrees|wktree)[/\\]feat)(\d+)$/);
	const pool = slotMatch
		? {
				index: Number(slotMatch[1]),
				placeholder: branchRef === `refs/heads/wk-pool/feat${slotMatch[1]}`,
			}
		: null;

	return {
		path,
		head,
		branch,
		branchRef,
		detached,
		bare,
		canonical,
		pool,
		locked,
		lockReason,
		prunable,
		prunableReason,
	};
};

export const parseWorktreeList = (porcelainOutput: string): Worktree[] => {
	const records = porcelainOutput
		.trim()
		.split(/\n{2,}/)
		.map((record) => record.trim())
		.filter(Boolean);

	return records.map((record, index) => parseRecord(record, index === 0));
};

export const parseTrunkFromSymbolicRef = (stdout: string): string | null => {
	const ref = stdout.trim();
	if (ref === "") return null;
	const originPrefix = "refs/remotes/origin/";
	return ref.startsWith(originPrefix) ? ref.slice(originPrefix.length) : ref;
};

export const parseTrunkFromRemoteShow = (stdout: string): string | null => {
	for (const line of stdout.split("\n")) {
		const match = line.match(/^\s*HEAD branch:\s*(\S+)\s*$/);
		if (match) return match[1] === "(unknown)" ? null : (match[1] ?? null);
	}
	return null;
};

export const branchExistsInList = (listOutput: string, branch: string): boolean =>
	listOutput
		.split("\n")
		.map((line) => line.trim().replace(/^[*+]\s*/, ""))
		.some((line) => line === branch);
