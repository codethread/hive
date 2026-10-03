import type { BranchState, Slot } from "../domain/worktree.ts";
import type { Deps, GitRunner, ProgressReporter } from "../services.ts";
import {
	detectBranchState,
	detectOriginDefaultBranch,
	resolveBaseRef,
	resolveDefaultBaseForNewBranch,
} from "../application/branches.ts";
import { EXIT_CODES } from "../errors.ts";
import type { TreesConfig } from "../domain/config.ts";
import { ensurePlaceholderBranch } from "../application/pool.ts";

const prepareAddBranch = async (options: {
	base: string | null;
	branch: string;
	config: TreesConfig;
	deps: Deps;
	root: string;
}) => {
	const { base, branch, config, deps, root } = options;
	await deps.git.run(["-C", root, "fetch", "origin"]);
	const branchState = await detectBranchState(deps.git, root, branch);
	const defaultBase = await resolveDefaultBaseForNewBranch({
		base,
		branchState,
		git: deps.git,
		policy: deps.config.explain(config, root).addPolicy,
		root,
	});
	return { base: base ?? defaultBase, branchState };
};

const warnIgnoredBase = (
	state: BranchState,
	base: string | null,
	progress: ProgressReporter,
): void => {
	if (state !== "none" && base) {
		progress.error("--base ignored: branch already exists");
	}
};

const captureExistingBranchHead = async (options: {
	git: GitRunner;
	root: string;
	branch: string;
	branchState: BranchState;
}): Promise<string | null> => {
	const { git, root, branch, branchState } = options;
	if (branchState !== "local" && branchState !== "local-remote") {
		// eslint-disable-next-line unicorn/no-null -- AddPlan serializes absent rollback heads as explicit null.
		return null;
	}
	const result = await git.run(["-C", root, "rev-parse", `refs/heads/${branch}`]);
	return result.stdout.trim();
};

const restoreBranchRef = async (options: {
	git: GitRunner;
	root: string;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, branch, branchState, originalBranchHead } = options;
	if (branchState === "none" || branchState === "remote") {
		await git.runRaw(["-C", root, "branch", "-D", branch]);
		return;
	}
	if (originalBranchHead) {
		await git.runRaw(["-C", root, "branch", "-f", branch, originalBranchHead]);
	}
};

const rollbackNonPoolAdd = async (options: {
	git: GitRunner;
	root: string;
	worktreePath: string;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, worktreePath, branch, branchState, originalBranchHead } = options;
	await git.runRaw(["-C", root, "worktree", "remove", "--force", worktreePath]);
	await restoreBranchRef({ branch, branchState, git, originalBranchHead, root });
};

const rollbackPooledAllocation = async (options: {
	git: GitRunner;
	root: string;
	slot: Slot;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, slot, branch, branchState, originalBranchHead } = options;
	const trunk = await detectOriginDefaultBranch(git, root);
	const placeholderBranch = `wk-pool/feat${slot.index}`;
	await ensurePlaceholderBranch({ branch: placeholderBranch, git, root, trunk });
	await git.runRaw(["-C", slot.path, "checkout", "-f", "-B", placeholderBranch, `origin/${trunk}`]);
	await git.runRaw(["-C", slot.path, "reset", "--hard", placeholderBranch]);
	await git.runRaw(["-C", slot.path, "clean", "-fd"]);
	await restoreBranchRef({ branch, branchState, git, originalBranchHead, root });
};

const resolveStartPoint = (git: GitRunner, root: string, base: string | null): Promise<string> => {
	if (base) {
		return resolveBaseRef(git, root, base);
	}
	return Promise.resolve("HEAD");
};

const addNonPoolWorktree = async (options: {
	git: GitRunner;
	root: string;
	path: string;
	branch: string;
	state: BranchState;
	base: string | null;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, root, path, branch, state, base, progress } = options;
	warnIgnoredBase(state, base, progress);
	if (state === "local" || state === "local-remote") {
		await git.run(["-C", root, "worktree", "add", path, branch]);
		return;
	}
	if (state === "remote") {
		await git.run([
			"-C",
			root,
			"worktree",
			"add",
			"--no-track",
			"-b",
			branch,
			path,
			`origin/${branch}`,
		]);
		return;
	}
	const startPoint = await resolveStartPoint(git, root, base);
	await git.run(["-C", root, "worktree", "add", "--no-track", "-b", branch, path, startPoint]);
};

const checkoutBranchInSlot = async (options: {
	git: GitRunner;
	slotPath: string;
	branch: string;
	state: BranchState;
	base: string | null;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, slotPath, branch, state, base, progress } = options;
	warnIgnoredBase(state, base, progress);
	if (state === "local" || state === "local-remote") {
		await git.run(["-C", slotPath, "checkout", branch]);
		return;
	}
	if (state === "remote") {
		await git.run(["-C", slotPath, "checkout", "--no-track", "-B", branch, `origin/${branch}`]);
		return;
	}
	const startPoint = await resolveStartPoint(git, slotPath, base);
	await git.run(["-C", slotPath, "checkout", "--no-track", "-B", branch, startPoint]);
};

const mergeOriginIfPresent = async (options: {
	git: GitRunner;
	worktreePath: string;
	branch: string;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, worktreePath, branch, progress } = options;
	const remote = await git.runRaw([
		"-C",
		worktreePath,
		"show-ref",
		"--verify",
		`refs/remotes/origin/${branch}`,
	]);
	if (remote.exitCode !== EXIT_CODES.SUCCESS) {
		return;
	}
	const merge = await git.runRaw(["-C", worktreePath, "merge", "--ff-only", `origin/${branch}`]);
	if (merge.exitCode !== EXIT_CODES.SUCCESS) {
		progress.error(`warning: couldn't fast-forward from origin/${branch}; preserving local work`);
	}
};

export {
	prepareAddBranch,
	captureExistingBranchHead,
	restoreBranchRef,
	rollbackNonPoolAdd,
	rollbackPooledAllocation,
	addNonPoolWorktree,
	checkoutBranchInSlot,
	mergeOriginIfPresent,
};
