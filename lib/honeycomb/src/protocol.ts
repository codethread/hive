import type { PolicyExplanation } from "./domain/config.ts";
import {
	type AddPlan,
	type RemovePlan,
	type Worktree,
	sessionNameForWorktreePath,
} from "./domain/worktree.ts";

import {
	BlockedError,
	CanonicalRootError,
	DirtyCanonicalError,
	DirtySlotError,
	DirtyWorktreeError,
	DuplicateBranchError,
	EXIT_CODES,
	FinishConflictError,
	NonFastForwardCanonicalError,
	PreRemoteCheckError,
	PushRejectedError,
	TargetNotFreshError,
	UnmergedBranchError,
	UnsafeOperationError,
	UsageError,
	HoneycombError,
	WrongCanonicalBranchError,
} from "./errors.ts";
import type { Deps } from "./services.ts";

export interface CommandResult {
	/** Output returned to the invoking shell, when present. */
	stdout?: string | undefined;
	/** Diagnostics returned to the invoking shell, when present. */
	stderr?: string;
	/** Process status from the documented exit-code taxonomy. */
	exitCode: number;
	/** Interactive follow-up run once output is written; it may end the process. */
	afterOutput?: (() => Promise<void>) | undefined;
}

export interface OutputMode {
	/** Whether the caller requests structured machine output. */
	json: boolean;
}

export const parseOutputMode = (opts: Record<string, string | boolean>): OutputMode => ({
	json: opts.json === true,
});

export const finalizeStructuredResult = (
	payload: object,
	output: OutputMode,
	exitCode: number = EXIT_CODES.SUCCESS,
): CommandResult => ({
	stdout: output.json ? `${JSON.stringify(payload, null, 2)}\n` : undefined,
	exitCode,
});

export const finalizeReadyResult = (
	payload: object,
	output: OutputMode,
	summary: string,
	afterOutput?: () => Promise<void>,
): CommandResult => {
	if (output.json) return { ...finalizeStructuredResult(payload, output), afterOutput };
	return { stderr: `${summary}\n`, exitCode: EXIT_CODES.SUCCESS, afterOutput };
};

export const toBlockedCommandResult = (
	error: unknown,
	output: OutputMode,
	context: Omit<BlockedPayload, "kind" | "reason" | "message">,
): CommandResult | null => {
	if (!output.json || !(error instanceof HoneycombError)) return null;
	const payload = toBlockedPayload(error, context);
	if (!payload) return null;
	const result = finalizeStructuredResult(payload, output, error.exitCode);
	if (error instanceof PreRemoteCheckError && error.stderr.trim() !== "") {
		return { ...result, stderr: `${error.stderr.trimEnd()}\n` };
	}
	return result;
};

const toBlockedPayload = (
	error: HoneycombError,
	context: Omit<BlockedPayload, "kind" | "reason" | "message">,
): BlockedPayload | null => {
	if (!(error instanceof BlockedError) && !(error instanceof UnsafeOperationError)) return null;
	let reason = "blocked";
	if (error instanceof DuplicateBranchError) reason = "duplicate_branch";
	else if (error instanceof DirtySlotError) reason = "dirty_slot";
	else if (error instanceof DirtyWorktreeError) reason = "dirty_worktree";
	else if (error instanceof DirtyCanonicalError) reason = "dirty_canonical";
	else if (error instanceof WrongCanonicalBranchError) reason = "wrong_canonical_branch";
	else if (error instanceof NonFastForwardCanonicalError) reason = "non_ff_canonical";
	else if (error instanceof TargetNotFreshError) reason = "target_not_fresh";
	else if (error instanceof FinishConflictError) reason = "conflict";
	else if (error instanceof PushRejectedError) reason = "push_rejected";
	else if (error instanceof UnmergedBranchError) reason = "unmerged_branch";
	else if (error instanceof PreRemoteCheckError) reason = "pre_remote_check_failed";
	else if (error instanceof CanonicalRootError) reason = "canonical_root";
	else if (error.exitCode === EXIT_CODES.UNSAFE) reason = "unsafe";
	return { kind: "blocked", reason, message: error.message, ...context };
};

export const withMachineJsonProgress = (deps: Deps, output: OutputMode): Deps => {
	if (!output.json) return deps;
	return {
		...deps,
		progress: {
			banner: (line: string) => deps.progress.banner(line),
			stream: (_stream: "stdout" | "stderr", line: string) => deps.progress.error(line),
			error: (msg: string) => deps.progress.error(msg),
		},
	};
};

export const toAddPayload = (plan: AddPlan): ReadyAddPayload => ({
	kind: "ready",
	worktree_path: plan.worktreePath,
	branch: plan.branch,
	root: plan.root,
	title: plan.title,
	session: toSessionInfo(plan.worktreePath),
	post_create_script_path: null,
	created_new_branch: plan.createdNewBranch,
	rollback_branch_head: plan.rollbackBranchHead,
});

export const toRemovePayload = (plan: RemovePlan): ReadyRemovePayload => ({
	kind: "ready",
	worktree_path: plan.worktreePath,
	removed: plan.removed,
	session: toSessionInfo(plan.worktreePath),
});

const toSessionInfo = (worktreePath: string): SessionInfo => ({
	name: sessionNameForWorktreePath(worktreePath),
	path: worktreePath,
});

export const toListJson = (worktree: Worktree) => ({
	path: worktree.path,
	head: worktree.head,
	branch: worktree.branch,
	branch_ref: worktree.branchRef,
	detached: worktree.detached,
	bare: worktree.bare,
	locked: worktree.locked,
	lock_reason: worktree.lockReason,
	prunable: worktree.prunable,
	prunable_reason: worktree.prunableReason,
	canonical: worktree.canonical,
	pool: worktree.pool,
	session: toSessionInfo(worktree.path),
});

export const formatWorktreeList = (worktrees: Worktree[]): string =>
	worktrees
		.map((worktree) => {
			const head = worktree.head ? worktree.head.slice(0, 7) : "-";
			const branch = worktree.branch
				? `[${worktree.branch}]`
				: worktree.detached
					? "(detached)"
					: "";
			const flags = [branch, worktree.canonical ? "[canonical]" : null, formatPool(worktree.pool)]
				.filter(Boolean)
				.join(" ");
			return `${worktree.path}  ${head}${flags ? ` ${flags}` : ""}`;
		})
		.join("\n")
		.concat(worktrees.length > 0 ? "\n" : "");

const formatPool = (pool: Worktree["pool"]): string | null => {
	if (!pool) return null;
	return pool.placeholder ? "[pool:free]" : `[pool:feat${pool.index}]`;
};

export const toConfigExplainPayload = (explanation: PolicyExplanation) => ({
	kind: "config_explain",
	root: explanation.canonicalRoot,
	matched_rules: explanation.matchedRules.map((rule) => ({ root_glob: rule.rootGlob })),
	project: explanation.project
		? { name: explanation.project.name, root: explanation.project.root }
		: null,
	command: {
		source: explanation.command.source,
		value: explanation.command.command,
	},
	pre_remote_check: {
		source: explanation.preRemoteCheck.source,
		value: explanation.preRemoteCheck.value,
	},
	worktree_location: explanation.worktreeLocation,
	add: { policy: explanation.addPolicy },
	finish: {
		enabled: explanation.finishPolicy.enabled,
		strategy: explanation.finishPolicy.strategy,
		push: explanation.finishPolicy.push,
		remove_worktree: explanation.finishPolicy.removeWorktree,
		delete_branch: explanation.finishPolicy.deleteBranch,
	},
});

export const formatCommandSource = (source: string | null): string => source ?? "(none)";

interface SessionInfo {
	/** Stable tmux session name. */
	name: string;
	/** Checkout path associated with the session or candidate. */
	path: string;
}

export interface ReadyAddPayload {
	/** Discriminator used by CLI and Nushell consumers. */
	kind: "ready";
	/** Checkout selected or created by the operation. */
	worktree_path: string;
	/** Requested or checked-out branch name. */
	branch: string;
	/** Canonical repository root. */
	root: string;
	/** Human-facing session title. */
	title: string;
	/** Session identity derived from the checkout path. */
	session: SessionInfo;
	/** Retained for compatibility; always null because add runs bootstrap itself. */
	post_create_script_path: null;
	/** Whether allocation created a local branch ref. */
	created_new_branch: boolean;
	/** Previous branch head available for wrapper rollback. */
	rollback_branch_head: string | null;
}

interface ReadyRemovePayload {
	/** Discriminator used by CLI and Nushell consumers. */
	kind: "ready";
	/** Checkout selected or created by the operation. */
	worktree_path: string;
	/** Whether the directory was removed rather than recycled. */
	removed: boolean;
	/** Session identity derived from the checkout path. */
	session: SessionInfo;
}

interface PoolFullCandidate {
	/** One-based fixed slot number. */
	slot: number;
	/** Checkout path associated with the session or candidate. */
	path: string;
	/** Requested or checked-out branch name. */
	branch: string | null;
	/** Whether the slot contains uncommitted changes. */
	dirty: boolean;
	/** Number of commits ahead of its upstream. */
	ahead: number;
	/** Whether the branch has no upstream. */
	local_only: boolean;
	/** Timestamp of the last commit, when available. */
	last_commit_iso: string | null;
	/** Subject of the last commit, when available. */
	last_commit_subject: string | null;
}

export interface PoolFullPayload {
	/** Discriminator used by CLI and Nushell consumers. */
	kind: "pool_full";
	/** Canonical repository root. */
	root: string;
	/** Requested or checked-out branch name. */
	branch: string;
	/** Occupied initialized slots available for explicit recycling. */
	candidates: PoolFullCandidate[];
}

interface BlockedPayload {
	/** Discriminator used by CLI and Nushell consumers. */
	kind: "blocked";
	/** Machine-readable refusal reason. */
	reason: string;
	/** Human-readable explanation of the refusal. */
	message: string;
	/** Requested or checked-out branch name. */
	branch?: string | undefined;
	/** Checkout selected or created by the operation. */
	worktree_path?: string | undefined;
	/** Explicitly selected pool path, when applicable. */
	slot_path?: string | undefined;
}

export const parseOptions = (args: string[]) => {
	const opts: Record<string, string | boolean> = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (
			arg === "--json" ||
			arg === "--interactive" ||
			arg === "--force" ||
			arg === "--keep-branch" ||
			arg === "--open" ||
			arg === "--base-current" ||
			arg === "--self"
		) {
			opts[arg.slice(2)] = true;
			continue;
		}
		if (arg?.startsWith("--")) {
			const key = arg.slice(2);
			const value = args[index + 1];
			if (value === undefined || value.startsWith("--"))
				throw new UsageError(`missing value for --${key}`);
			opts[key] = value;
			index++;
		}
	}
	return opts;
};

export const requireOption = (opts: Record<string, string | boolean>, key: string): string => {
	const value = opts[key];
	if (typeof value !== "string" || value === "") throw new UsageError(`missing required --${key}`);
	return value;
};
