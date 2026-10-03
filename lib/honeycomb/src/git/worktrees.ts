// :module: Pure parsers for git worktree and branch command output

import type { Worktree } from "../domain/worktree.ts";

const REF_HEADS_PREFIX = "refs/heads/";
const ORIGIN_REF_PREFIX = "refs/remotes/origin/";
const UNKNOWN_HEAD = "(unknown)";
const POOL_SLOT_PATTERN = /(?:__feat|[/\\]\.(?:worktrees|wktree)[/\\]feat)(?<slot>\d+)$/u;
const HEAD_BRANCH_PATTERN = /^\s*HEAD branch:\s*(?<branch>\S+)\s*$/u;
const BRANCH_LIST_MARKER = /^[*+]\s*/u;
const PORCELAIN_RECORD_SEPARATOR = /\n{2,}/u;
const CANONICAL_WORKTREE_INDEX = 0;

interface RecordFields {
	/** Last value of each space-delimited Git field. */
	attributes: Map<string, string>;
	/** Standalone markers such as detached, bare, or locked. */
	flags: Set<string>;
}

const splitRecordLines = (record: string): RecordFields => {
	const attributes = new Map<string, string>();
	const flags = new Set<string>();
	for (const line of record.split("\n")) {
		if (line.includes(" ")) {
			const [key = line, ...rest] = line.split(" ");
			attributes.set(key, rest.join(" "));
		} else {
			flags.add(line);
		}
	}
	return { attributes, flags };
};

// Git porcelain omits absent fields while Worktree JSON encodes that absence as explicit null; these null literals are the external contract, not a sentinel.

const localBranchName = (branchRef: string | null): string | null => {
	if (branchRef === null || !branchRef.startsWith(REF_HEADS_PREFIX)) {
		// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
		return null;
	}
	return branchRef.slice(REF_HEADS_PREFIX.length);
};

const poolIdentity = (path: string, branchRef: string | null): Worktree["pool"] => {
	const slot = POOL_SLOT_PATTERN.exec(path)?.groups?.slot;
	if (slot === undefined) {
		// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
		return null;
	}
	return {
		index: Number(slot),
		placeholder: branchRef === `refs/heads/wk-pool/feat${slot}`,
	};
};

const parseRecord = (record: string, canonical: boolean): Worktree => {
	const { attributes, flags } = splitRecordLines(record);
	// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
	const path = attributes.get("worktree") ?? null;
	if (path === null) {
		throw new Error("git worktree porcelain record is missing worktree path");
	}
	// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
	const branchRef = attributes.get("branch") ?? null;
	// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
	const lockReason = attributes.get("locked") ?? null;
	// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
	const prunableReason = attributes.get("prunable") ?? null;
	return {
		bare: flags.has("bare"),
		branch: localBranchName(branchRef),
		branchRef,
		canonical,
		detached: flags.has("detached"),
		// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
		head: attributes.get("HEAD") ?? null,
		lockReason,
		locked: flags.has("locked") || lockReason !== null,
		path,
		pool: poolIdentity(path, branchRef),
		prunable: flags.has("prunable") || prunableReason !== null,
		prunableReason,
	};
};

const parseWorktreeList = (porcelainOutput: string): Worktree[] => {
	const records = porcelainOutput
		.trim()
		.split(PORCELAIN_RECORD_SEPARATOR)
		.map((record) => record.trim())
		.filter(Boolean);

	return records.map((record, index) => parseRecord(record, index === CANONICAL_WORKTREE_INDEX));
};

const parseTrunkFromSymbolicRef = (stdout: string): string | null => {
	const ref = stdout.trim();
	if (ref === "") {
		// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
		return null;
	}
	if (!ref.startsWith(ORIGIN_REF_PREFIX)) {
		return ref;
	}
	return ref.slice(ORIGIN_REF_PREFIX.length);
};

const parseTrunkFromRemoteShow = (stdout: string): string | null => {
	for (const line of stdout.split("\n")) {
		const branch = HEAD_BRANCH_PATTERN.exec(line)?.groups?.branch;
		if (branch !== undefined) {
			if (branch === UNKNOWN_HEAD) {
				// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
				return null;
			}
			return branch;
		}
	}
	// oxlint-disable-next-line unicorn/no-null -- Absent Git metadata is an explicit-null public parser contract.
	return null;
};

const branchExistsInList = (listOutput: string, branch: string): boolean =>
	listOutput
		.split("\n")
		.map((line) => line.trim().replace(BRANCH_LIST_MARKER, ""))
		.some((line) => line === branch);

export {
	branchExistsInList,
	parseTrunkFromRemoteShow,
	parseTrunkFromSymbolicRef,
	parseWorktreeList,
};
