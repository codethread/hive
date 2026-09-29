import { basename, dirname, isAbsolute, resolve } from "node:path";
import { UsageError } from "../errors.ts";
import type { WorktreeLocation } from "./config.ts";

export const NESTED_WORKTREE_DIR = ".worktrees";

export const sessionNameForWorktreePath = (worktreePath: string): string => {
	const parent = dirname(worktreePath);
	const parentName = basename(parent);
	const name =
		parentName === NESTED_WORKTREE_DIR || parentName === ".wktree"
			? `${basename(dirname(parent))}__${basename(worktreePath)}`
			: basename(worktreePath);
	return name.replaceAll(".", "_");
};

export const encodeBranch = (branch: string): string => {
	const parts = branch.split("/").filter((part) => part !== "");
	if (parts.length === 0) throw new UsageError(`invalid branch name: ${branch}`);
	return parts.join("--");
};

export const worktreePathForName = (
	root: string,
	name: string,
	location: WorktreeLocation,
): string =>
	location === "nested" ? resolve(root, NESTED_WORKTREE_DIR, name) : `${root}__${name}`;

export const generatePostCreateScript = (spec: PostCreateScriptSpec): string => {
	const lines = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`export WK_ROOT=${shellQuote(spec.root)}`,
		`export WK_CREATED=${shellQuote(spec.created)}`,
		`echo ${shellQuote(`project: ${spec.projectName}`)}`,
		'cd "$WK_CREATED"',
		spec.command.trimEnd(),
	];
	if (spec.pooled) {
		lines.push(': > "$(git -C "$WK_CREATED" rev-parse --git-path wk-pool-initialized)"');
	}
	return `${lines.join("\n")}\n`;
};

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const resolveCopySource = (root: string, from: string, home: string): string => {
	if (from === "~") return home;
	if (from.startsWith("~/")) return resolve(home, from.slice(2));
	return isAbsolute(from) ? from : resolve(root, from);
};

export interface Worktree {
	/** Checkout path reported by Git. */
	path: string;
	/** Checked-out commit, absent for a bare repository. */
	head: string | null;
	/** Local branch name, absent for detached or bare worktrees. */
	branch: string | null;
	/** Full branch ref reported by Git. */
	branchRef: string | null;
	/** Whether HEAD is detached from a branch. */
	detached: boolean;
	/** Whether the entry is a bare repository. */
	bare: boolean;
	/** Whether this is the protected first worktree in Git's listing. */
	canonical: boolean;
	/** Whether Git has locked this worktree. */
	locked: boolean;
	/** Git's lock explanation, when supplied. */
	lockReason: string | null;
	/** Whether Git considers this worktree prunable. */
	prunable: boolean;
	/** Git's prune explanation, when supplied. */
	prunableReason: string | null;
	/** Fixed slot identity inferred from its managed path. */
	pool: PoolSlotIdentity | null;
}

export interface PoolSlotIdentity {
	/** One-based slot number. */
	index: number;
	/** Whether the slot currently holds its reserved placeholder branch. */
	placeholder: boolean;
}

export interface Slot {
	/** One-based slot number. */
	index: number;
	/** Actual or planned path of the slot. */
	path: string;
	/** Whether Git currently lists the slot. */
	exists: boolean;
	/** Checked-out local branch, if any. */
	branch: string | null;
	/** Whether the slot is available on its placeholder branch. */
	placeholder: boolean;
	/** Whether Git reports uncommitted changes. */
	dirty: boolean;
	/** Commit timestamp reported by Git, when available. */
	lastCommitIso: string | null;
	/** Latest commit subject, when available. */
	lastCommitSubject: string | null;
	/** Whether the successful bootstrap marker exists. */
	initialized: boolean;
}

export interface PoolState {
	/** Canonical repository root. */
	root: string;
	/** Origin's default branch; empty when no pool is configured. */
	trunk: string;
	/** Whether this project uses fixed slots. */
	hasPool: boolean;
	/** Configured number of slots. */
	size: number;
	/** Latest observations for each configured slot. */
	slots: Slot[];
}

export interface AddPlan {
	/** Allocated checkout path. */
	worktreePath: string;
	/** Checked-out local branch. */
	branch: string;
	/** Canonical repository root. */
	root: string;
	/** Human-facing session title. */
	title: string;
	/** Whether allocation created a local branch ref. */
	createdNewBranch: boolean;
	/** Previous branch head available for rollback. */
	rollbackBranchHead: string | null;
}

export interface RemovePlan {
	/** Checkout path selected for cleanup. */
	worktreePath: string;
	/** Whether cleanup removed the directory rather than recycling a slot. */
	removed: boolean;
}

export interface PostCreateScriptSpec {
	/** Project name displayed during setup. */
	projectName: string;
	/** Canonical root exported to the hook. */
	root: string;
	/** New checkout exported to the hook and used as its working directory. */
	created: string;
	/** Configured Bash setup command. */
	command: string;
	/** Whether successful setup should write a pool initialization marker. */
	pooled: boolean;
}

export interface CopiedFile {
	/** Materialized source path. */
	from: string;
	/** Destination relative to the target checkout. */
	to: string;
	/** Kind of filesystem asset created. */
	type: "file" | "directory" | "symlink";
}

export type BranchState = "local" | "remote" | "local-remote" | "none";
