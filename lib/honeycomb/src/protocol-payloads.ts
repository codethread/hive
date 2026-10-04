import type { AddPlan, RemovePlan, Worktree } from "./domain/worktree.ts";
import type { PolicyExplanation, ProjectConfig } from "./domain/config.ts";
import { sessionNameForWorktreePath } from "./domain/worktree.ts";

const SHORT_COMMIT_LENGTH = 7;
const COMMIT_START = 0;

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

export function toAddPayload(plan: AddPlan): ReadyAddPayload {
	return {
		branch: plan.branch,
		created_new_branch: plan.createdNewBranch,
		kind: "ready",
		// oxlint-disable-next-line unicorn/no-null -- Wrapper protocol retains the retired field as explicit null.
		post_create_script_path: null,
		rollback_branch_head: plan.rollbackBranchHead,
		root: plan.root,
		session: toSessionInfo(plan.worktreePath),
		title: plan.title,
		worktree_path: plan.worktreePath,
	};
}

export function toRemovePayload(plan: RemovePlan): ReadyRemovePayload {
	return {
		kind: "ready",
		removed: plan.removed,
		session: toSessionInfo(plan.worktreePath),
		worktree_path: plan.worktreePath,
	};
}

export function toListJson(worktree: Worktree) {
	return {
		bare: worktree.bare,
		branch: worktree.branch,
		branch_ref: worktree.branchRef,
		canonical: worktree.canonical,
		detached: worktree.detached,
		head: worktree.head,
		lock_reason: worktree.lockReason,
		locked: worktree.locked,
		path: worktree.path,
		pool: worktree.pool,
		prunable: worktree.prunable,
		prunable_reason: worktree.prunableReason,
		session: toSessionInfo(worktree.path),
	};
}

export function formatWorktreeList(worktrees: Worktree[]): string {
	const lines = worktrees.map(
		(worktree) => `${worktree.path}  ${formatHead(worktree.head)}${formatFlagsSuffix(worktree)}`,
	);
	return lines.map((line) => `${line}\n`).join("");
}

export function toConfigExplainPayload(explanation: PolicyExplanation) {
	return {
		add: { policy: explanation.addPolicy },
		command: {
			source: explanation.command.source,
			value: explanation.command.command,
		},
		finish: {
			delete_branch: explanation.finishPolicy.deleteBranch,
			enabled: explanation.finishPolicy.enabled,
			push: explanation.finishPolicy.push,
			remove_worktree: explanation.finishPolicy.removeWorktree,
			strategy: explanation.finishPolicy.strategy,
		},
		kind: "config_explain",
		matched_rules: explanation.matchedRules.map((rule) => ({ root_glob: rule.rootGlob })),
		pre_remote_check: {
			source: explanation.preRemoteCheck.source,
			value: explanation.preRemoteCheck.value,
		},
		project: toProjectPayload(explanation.project),
		root: explanation.canonicalRoot,
		worktree_location: explanation.worktreeLocation,
	};
}

export function formatCommandSource(source: string | null): string {
	return source ?? "(none)";
}

export function formatConfigSummary(payload: ReturnType<typeof toConfigExplainPayload>): string {
	const matchedRules = payload.matched_rules.map((rule) => rule.root_glob).join(", ") || "(none)";
	const project = formatProject(payload.project);
	return `root: ${payload.root}\nmatched_rules: ${matchedRules}\nproject: ${project}\ncommand.source: ${formatCommandSource(payload.command.source)}\npre_remote_check.source: ${formatCommandSource(payload.pre_remote_check.source)}\nworktree_location: ${payload.worktree_location}\nadd.policy: ${payload.add.policy}\nfinish.enabled: ${payload.finish.enabled}\nfinish.strategy: ${payload.finish.strategy}\nfinish.push: ${payload.finish.push}\nfinish.remove_worktree: ${payload.finish.remove_worktree}\nfinish.delete_branch: ${payload.finish.delete_branch}\n`;
}
// --- Private functions ---

function toSessionInfo(worktreePath: string): SessionInfo {
	return {
		name: sessionNameForWorktreePath(worktreePath),
		path: worktreePath,
	};
}

function formatHead(head: string | null): string {
	if (!head) {
		return "-";
	}
	return head.slice(COMMIT_START, SHORT_COMMIT_LENGTH);
}

function formatBranch(worktree: Worktree): string {
	if (worktree.branch) {
		return `[${worktree.branch}]`;
	}
	if (worktree.detached) {
		return "(detached)";
	}
	return "";
}

function formatPool(pool: Worktree["pool"]): string {
	if (!pool) {
		return "";
	}
	if (pool.placeholder) {
		return "[pool:free]";
	}
	return `[pool:feat${pool.index}]`;
}

function formatFlags(worktree: Worktree): string {
	const flags: string[] = [];
	const branch = formatBranch(worktree);
	if (branch) {
		flags.push(branch);
	}
	if (worktree.canonical) {
		flags.push("[canonical]");
	}
	const pool = formatPool(worktree.pool);
	if (pool) {
		flags.push(pool);
	}
	return flags.join(" ");
}

function formatFlagsSuffix(worktree: Worktree): string {
	const flags = formatFlags(worktree);
	if (!flags) {
		return "";
	}
	return ` ${flags}`;
}

function toProjectPayload(
	project: ProjectConfig | undefined,
): { name: string | null; root: string } | null {
	if (project === undefined) {
		// oxlint-disable-next-line unicorn/no-null -- CLI protocol renders an unconfigured project as explicit null.
		return null;
	}
	return { name: project.name, root: project.root };
}

function formatProject(project: { name: string | null; root: string } | null): string {
	if (!project) {
		return "(none)";
	}
	return `${project.name ?? "(unnamed)"} ${project.root}`;
}
