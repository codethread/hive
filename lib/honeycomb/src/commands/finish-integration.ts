import type { AddPolicy, FinishStrategy } from "../domain/config.ts";
import {
	DirtyWorktreeError,
	EXIT_CODES,
	FinishConflictError,
	TargetNotFreshError,
} from "../errors.ts";
import type { GitRunner } from "../services.ts";
import type { Worktree } from "../domain/worktree.ts";
import { assertCanonicalCanFastForward } from "../application/branches.ts";

interface IntegrateOptions {
	/** Canonical checkout receiving integrated changes. */
	canonicalPath: string;
	/** Git process boundary. */
	git: GitRunner;
	/** Source branch being integrated. */
	sourceBranch: string;
	/** Source checkout used by the rebase strategy. */
	sourcePath: string;
	/** Configured integration strategy. */
	strategy: FinishStrategy;
	/** Ref that integration must update. */
	targetRef: string;
}

const assertCleanSource = async (git: GitRunner, source: Worktree): Promise<void> => {
	const status = await git.run(["-C", source.path, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "") {
		throw new DirtyWorktreeError("source worktree has uncommitted changes");
	}
};

const assertSourceCanFastForwardTarget = async (options: {
	canonicalPath: string;
	git: GitRunner;
	sourceBranch: string;
	targetRef: string;
}): Promise<void> => {
	const canFastForward = await options.git.runRaw([
		"-C",
		options.canonicalPath,
		"merge-base",
		"--is-ancestor",
		options.targetRef,
		`refs/heads/${options.sourceBranch}`,
	]);
	if (canFastForward.exitCode !== EXIT_CODES.SUCCESS) {
		throw new FinishConflictError("source branch cannot fast-forward target branch");
	}
};

const integrateFastForward = async (options: IntegrateOptions): Promise<void> => {
	await options.git.run(["-C", options.canonicalPath, "merge", "--ff-only", options.sourceBranch]);
};

const integrateSquash = async (options: IntegrateOptions): Promise<void> => {
	const merge = await options.git.runRaw([
		"-C",
		options.canonicalPath,
		"merge",
		"--squash",
		options.sourceBranch,
	]);
	if (merge.exitCode !== EXIT_CODES.SUCCESS) {
		throw new FinishConflictError("squash merge stopped with conflicts");
	}
	const commit = await options.git.runRaw([
		"-C",
		options.canonicalPath,
		"commit",
		"-m",
		finishCommitMessage("integrate", options.sourceBranch),
	]);
	if (commit.exitCode !== EXIT_CODES.SUCCESS) {
		throw new FinishConflictError("squash commit failed");
	}
};

const integrateMergeCommit = async (options: IntegrateOptions): Promise<void> => {
	const merge = await options.git.runRaw([
		"-C",
		options.canonicalPath,
		"merge",
		"--no-ff",
		"-m",
		finishCommitMessage("merge", options.sourceBranch),
		options.sourceBranch,
	]);
	if (merge.exitCode !== EXIT_CODES.SUCCESS) {
		throw new FinishConflictError("merge stopped with conflicts");
	}
};

const integrateRebase = async (options: IntegrateOptions): Promise<void> => {
	const rebase = await options.git.runRaw(["-C", options.sourcePath, "rebase", options.targetRef]);
	if (rebase.exitCode !== EXIT_CODES.SUCCESS) {
		throw new FinishConflictError("rebase stopped with conflicts");
	}
	await options.git.run(["-C", options.canonicalPath, "merge", "--ff-only", options.sourceBranch]);
};

const integrateSource = async (options: IntegrateOptions): Promise<void> => {
	switch (options.strategy) {
		case "ff_only": {
			await integrateFastForward(options);
			return;
		}
		case "squash": {
			await integrateSquash(options);
			return;
		}
		case "merge_commit": {
			await integrateMergeCommit(options);
			return;
		}
		case "rebase_ff": {
			await integrateRebase(options);
		}
	}
};

const assertCanonicalFresh = async (
	git: GitRunner,
	root: string,
	targetBranch: string,
): Promise<string> => {
	await assertCanonicalCanFastForward(git, root, targetBranch);
	return `origin/${targetBranch}`;
};

const assertWorktreeOnTargetBranch = (current: string, targetBranch: string): void => {
	if (current !== targetBranch) {
		throw new TargetNotFreshError(
			`target branch must be checked out on ${targetBranch}; currently on ${current || "detached HEAD"}`,
		);
	}
};

const assertTargetContainsOrigin = async (
	git: GitRunner,
	root: string,
	targetBranch: string,
): Promise<void> => {
	const targetIsCurrent = await git.runRaw([
		"-C",
		root,
		"merge-base",
		"--is-ancestor",
		`origin/${targetBranch}`,
		"HEAD",
	]);
	if (targetIsCurrent.exitCode !== EXIT_CODES.SUCCESS) {
		throw new TargetNotFreshError(`target branch is behind origin/${targetBranch}`);
	}
};

const assertFinishTargetReady = async (options: {
	git: GitRunner;
	policy: AddPolicy;
	root: string;
	targetBranch: string;
}): Promise<string> => {
	const { git, policy, root, targetBranch } = options;
	if (policy === "fresh_canonical") {
		return assertCanonicalFresh(git, root, targetBranch);
	}
	const status = await git.run(["-C", root, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "") {
		throw new TargetNotFreshError("target worktree has uncommitted changes");
	}
	const branch = await git.run(["-C", root, "branch", "--show-current"]);
	assertWorktreeOnTargetBranch(branch.stdout.trim(), targetBranch);
	await assertTargetContainsOrigin(git, root, targetBranch);
	return `refs/heads/${targetBranch}`;
};

const finishCommitMessage = (action: "integrate" | "merge", sourceBranch: string): string =>
	`chore: ${action} worktree\n\nSource branch:\n${sourceBranch.match(/.{1,40}/gu)?.join("\n") ?? sourceBranch}`;

export {
	assertCleanSource,
	assertFinishTargetReady,
	assertSourceCanFastForwardTarget,
	integrateSource,
};
