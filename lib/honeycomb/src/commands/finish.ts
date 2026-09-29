import {
	assertCanonicalCanFastForward,
	detectOriginDefaultBranch,
	fastForwardCanonicalDefault,
} from "../application/branches.ts";
import { planLeaveWorktree } from "../application/interactive.ts";
import { buildPoolState, ensurePlaceholderBranch } from "../application/pool.ts";
import { runPreRemoteCheck } from "../application/hooks.ts";
import { listWorktrees, resolveWorktreeContainingPath } from "../application/repository.ts";
import type {
	AddPolicy,
	FinishStrategy,
	ProjectConfig,
	WorktreeLocation,
} from "../domain/config.ts";
import type { Worktree } from "../domain/worktree.ts";
import {
	BlockedError,
	CanonicalRootError,
	DirtyWorktreeError,
	FinishConflictError,
	PushRejectedError,
	TargetNotFreshError,
	UnsafeOperationError,
	UsageError,
	HoneycombError,
} from "../errors.ts";
import {
	finalizeReadyResult,
	parseOptions,
	parseOutputMode,
	requireOption,
	toBlockedCommandResult,
	withMachineJsonProgress,
} from "../protocol.ts";
import type { Deps, GitRunner, WorkspaceFiles } from "../services.ts";

export const finishCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	const interactive = opts.interactive === true;
	for (const key of Object.keys(opts)) {
		if (key !== "cwd" && key !== "json" && key !== "interactive")
			throw new UsageError(`unknown option --${key}`);
	}
	const machineDeps = withMachineJsonProgress(deps, output);
	let sourceBranch: string | undefined;
	let worktreePath: string | undefined;

	try {
		const config = deps.config.read();
		const worktrees = await listWorktrees(machineDeps.git, cwd);
		const canonical = worktrees.find((worktree) => worktree.canonical);
		if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
		const source = resolveWorktreeContainingPath(worktrees, cwd, deps.files);
		if (!source) throw new UsageError(`no worktree contains cwd: ${cwd}`);
		worktreePath = source.path;
		if (deps.files.normalizePath(source.path) === deps.files.normalizePath(canonical.path)) {
			throw new CanonicalRootError("refusing to finish from canonical root");
		}
		if (!source.branch)
			throw new UsageError("finish requires a source worktree checked out on a branch");
		sourceBranch = source.branch;

		const project = deps.config.explain(config, canonical.path).project;
		await runPreRemoteCheck(deps, { config, root: canonical.path, operation: "honeycomb finish" });
		const explanation = deps.config.explain(config, canonical.path);
		const finishPolicy = explanation.finishPolicy;
		if (!finishPolicy.enabled) throw new BlockedError("finish is disabled for this repository");
		const strategy = finishPolicy.strategy;
		const push = finishPolicy.push;
		const removeWorktree = finishPolicy.removeWorktree;
		const deleteBranch = finishPolicy.deleteBranch;
		if (deleteBranch && !removeWorktree) {
			throw new UnsafeOperationError(
				"cannot delete source branch while its worktree remains checked out; enable remove_worktree cleanup",
			);
		}

		const sourceStatus = await machineDeps.git.run(["-C", source.path, "status", "--porcelain=v1"]);
		if (sourceStatus.stdout.trim() !== "")
			throw new DirtyWorktreeError("source worktree has uncommitted changes");

		await machineDeps.git.run(["-C", canonical.path, "fetch", "origin"]);
		const targetBranch = await detectOriginDefaultBranch(machineDeps.git, canonical.path);
		const policy = explanation.addPolicy;
		const targetRef = await assertFinishTargetReady({
			git: machineDeps.git,
			root: canonical.path,
			policy,
			targetBranch,
		});

		if (strategy === "ff_only") {
			await assertSourceCanFastForwardTarget({
				git: machineDeps.git,
				canonicalPath: canonical.path,
				targetRef,
				sourceBranch: source.branch,
			});
		}
		if (policy === "fresh_canonical")
			await fastForwardCanonicalDefault(machineDeps.git, canonical.path, targetBranch);
		await integrateFinishedBranch({
			git: machineDeps.git,
			canonicalPath: canonical.path,
			sourcePath: source.path,
			sourceBranch: source.branch,
			targetRef,
			strategy,
		});

		const cleanupActions: string[] = [];
		let afterOutput: (() => Promise<void>) | undefined;
		if (push) {
			const pushed = await machineDeps.git.runRaw([
				"-C",
				canonical.path,
				"push",
				"origin",
				targetBranch,
			]);
			if (pushed.exitCode !== 0) throw new PushRejectedError(`push rejected for ${targetBranch}`);
			cleanupActions.push("push");
		}
		if (removeWorktree) {
			if (interactive) {
				afterOutput = planLeaveWorktree(deps, {
					cwd,
					root: canonical.path,
					worktreePath: source.path,
				});
			}
			await cleanupFinishedWorktree({
				files: deps.files,
				git: machineDeps.git,
				project,
				root: canonical.path,
				source,
				deleteBranch,
				worktreeLocation: explanation.worktreeLocation,
			});
			cleanupActions.push(source.pool ? "recycle_worktree" : "remove_worktree");
			if (deleteBranch) cleanupActions.push("delete_branch");
		}

		const payload = {
			kind: "ready",
			root: canonical.path,
			worktree_path: source.path,
			source_branch: source.branch,
			target_branch: targetBranch,
			strategy,
			cleanup_actions: cleanupActions,
		};
		return finalizeReadyResult(
			payload,
			output,
			`honeycomb: finished ${payload.source_branch} into ${payload.target_branch}`,
			afterOutput,
		);
	} catch (error) {
		const blocked = toBlockedCommandResult(error, output, {
			branch: sourceBranch,
			worktree_path: worktreePath,
		});
		if (blocked) return blocked;
		throw error;
	}
};

const cleanupFinishedWorktree = async (options: {
	files: WorkspaceFiles;
	git: GitRunner;
	project: ProjectConfig | undefined;
	root: string;
	source: Worktree;
	deleteBranch: boolean;
	worktreeLocation: WorktreeLocation;
}): Promise<void> => {
	const { git, files, project, root, source, deleteBranch, worktreeLocation } = options;
	if (!source.branch) throw new UsageError("finish cleanup requires a source branch");
	const status = await git.run(["-C", source.path, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "")
		throw new DirtyWorktreeError("source worktree has uncommitted changes");
	if (project?.poolSize && source.pool) {
		const state = await buildPoolState(
			project,
			await listWorktrees(git, root),
			{ git, files },
			worktreeLocation,
		);
		const slot = state.slots.find(
			(candidate) => files.normalizePath(candidate.path) === files.normalizePath(source.path),
		);
		if (!slot) throw new UsageError(`pool slot not found: ${source.path}`);
		const placeholderBranch = `wk-pool/feat${slot.index}`;
		await ensurePlaceholderBranch({ git, root, branch: placeholderBranch, trunk: state.trunk });
		await git.run([
			"-C",
			source.path,
			"checkout",
			"-B",
			placeholderBranch,
			`origin/${state.trunk}`,
		]);
		if (deleteBranch) await git.run(["-C", root, "branch", "-D", source.branch]);
		return;
	}
	await git.run(["-C", root, "worktree", "remove", source.path]);
	if (deleteBranch) await git.run(["-C", root, "branch", "-D", source.branch]);
};

const assertSourceCanFastForwardTarget = async (options: {
	git: GitRunner;
	canonicalPath: string;
	targetRef: string;
	sourceBranch: string;
}): Promise<void> => {
	const { git, canonicalPath, targetRef, sourceBranch } = options;
	const canFastForward = await git.runRaw([
		"-C",
		canonicalPath,
		"merge-base",
		"--is-ancestor",
		targetRef,
		`refs/heads/${sourceBranch}`,
	]);
	if (canFastForward.exitCode !== 0)
		throw new FinishConflictError("source branch cannot fast-forward target branch");
};

const integrateFinishedBranch = async (options: {
	git: GitRunner;
	canonicalPath: string;
	sourcePath: string;
	sourceBranch: string;
	targetRef: string;
	strategy: FinishStrategy;
}): Promise<void> => {
	const { git, canonicalPath, sourcePath, sourceBranch, targetRef, strategy } = options;
	switch (strategy) {
		case "ff_only":
			await git.run(["-C", canonicalPath, "merge", "--ff-only", sourceBranch]);
			return;
		case "squash": {
			const merge = await git.runRaw(["-C", canonicalPath, "merge", "--squash", sourceBranch]);
			if (merge.exitCode !== 0)
				throw new FinishConflictError("squash merge stopped with conflicts");
			const commit = await git.runRaw([
				"-C",
				canonicalPath,
				"commit",
				"-m",
				finishCommitMessage("integrate", sourceBranch),
			]);
			if (commit.exitCode !== 0) throw new FinishConflictError("squash commit failed");
			return;
		}
		case "merge_commit": {
			const merge = await git.runRaw([
				"-C",
				canonicalPath,
				"merge",
				"--no-ff",
				"-m",
				finishCommitMessage("merge", sourceBranch),
				sourceBranch,
			]);
			if (merge.exitCode !== 0) throw new FinishConflictError("merge stopped with conflicts");
			return;
		}
		case "rebase_ff": {
			const rebase = await git.runRaw(["-C", sourcePath, "rebase", targetRef]);
			if (rebase.exitCode !== 0) throw new FinishConflictError("rebase stopped with conflicts");
			await git.run(["-C", canonicalPath, "merge", "--ff-only", sourceBranch]);
			return;
		}
	}
};

const finishCommitMessage = (action: "integrate" | "merge", sourceBranch: string): string =>
	`chore: ${action} worktree\n\nSource branch:\n${sourceBranch.match(/.{1,40}/gu)?.join("\n") ?? sourceBranch}`;

const assertFinishTargetReady = async (options: {
	git: GitRunner;
	root: string;
	policy: AddPolicy;
	targetBranch: string;
}): Promise<string> => {
	const { git, root, policy, targetBranch } = options;
	if (policy === "fresh_canonical") {
		await assertCanonicalCanFastForward(git, root, targetBranch);
		return `origin/${targetBranch}`;
	}
	const status = await git.run(["-C", root, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "")
		throw new TargetNotFreshError("target worktree has uncommitted changes");
	const current = (await git.run(["-C", root, "branch", "--show-current"])).stdout.trim();
	if (current !== targetBranch) {
		throw new TargetNotFreshError(
			`target branch must be checked out on ${targetBranch}; currently on ${current || "detached HEAD"}`,
		);
	}
	const targetIsCurrent = await git.runRaw([
		"-C",
		root,
		"merge-base",
		"--is-ancestor",
		`origin/${targetBranch}`,
		"HEAD",
	]);
	if (targetIsCurrent.exitCode !== 0)
		throw new TargetNotFreshError(`target branch is behind origin/${targetBranch}`);
	return `refs/heads/${targetBranch}`;
};
