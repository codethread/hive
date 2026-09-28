import type { AddPolicy } from "../domain/config.ts";
import type { BranchState } from "../domain/worktree.ts";
import {
	DirtyCanonicalError,
	DirtyWorktreeError,
	NonFastForwardCanonicalError,
	TrunkDetectionError,
	UnmergedBranchError,
	UsageError,
	HoneycombError,
	WrongCanonicalBranchError,
} from "../errors.ts";
import { parseTrunkFromRemoteShow, parseTrunkFromSymbolicRef } from "../git/worktrees.ts";
import type { GitRunner } from "../services.ts";

export const detectBranchState = async (
	git: GitRunner,
	root: string,
	branch: string,
): Promise<BranchState> => {
	const refs = await git.runRaw([
		"-C",
		root,
		"for-each-ref",
		"--format=%(refname)",
		"refs/heads",
		"refs/remotes/origin",
	]);
	const lines = refs.stdout.split("\n");
	const local = lines.includes(`refs/heads/${branch}`);
	const remote = lines.includes(`refs/remotes/origin/${branch}`);
	if (local && remote) return "local-remote";
	if (local) return "local";
	if (remote) return "remote";
	return "none";
};

export const detectOriginDefaultBranch = async (git: GitRunner, root: string): Promise<string> => {
	const symbolic = await git.runRaw(["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD"]);
	const fromSymbolic = symbolic.exitCode === 0 ? parseTrunkFromSymbolicRef(symbolic.stdout) : null;
	if (fromSymbolic) return fromSymbolic;
	const remoteShow = await git.runRaw(["-C", root, "remote", "show", "origin"]);
	const fromRemoteShow =
		remoteShow.exitCode === 0 ? parseTrunkFromRemoteShow(remoteShow.stdout) : null;
	if (fromRemoteShow) return fromRemoteShow;
	throw new TrunkDetectionError("couldn't determine origin default branch");
};

export const resolveDefaultBaseForNewBranch = async (options: {
	git: GitRunner;
	root: string;
	policy: AddPolicy;
	branchState: BranchState;
	base: string | null;
}): Promise<string | null> => {
	const { git, root, policy, branchState, base } = options;
	if (branchState !== "none") return null;
	if (base) return base;
	if (policy === "fresh_canonical") {
		const defaultBranch = await detectOriginDefaultBranch(git, root);
		await fastForwardCanonicalDefault(git, root, defaultBranch);
		return defaultBranch;
	}
	const defaultBranch = await detectOriginDefaultBranch(git, root);
	return `origin/${defaultBranch}`;
};

export const assertCanonicalCanFastForward = async (
	git: GitRunner,
	root: string,
	defaultBranch: string,
): Promise<void> => {
	const status = await git.run(["-C", root, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "") {
		throw new DirtyCanonicalError("canonical root has uncommitted changes");
	}
	const current = (await git.run(["-C", root, "branch", "--show-current"])).stdout.trim();
	if (current !== defaultBranch) {
		throw new WrongCanonicalBranchError(
			`canonical root must be checked out on ${defaultBranch}; currently on ${current || "detached HEAD"}`,
		);
	}
	const ancestor = await git.runRaw([
		"-C",
		root,
		"merge-base",
		"--is-ancestor",
		"HEAD",
		`origin/${defaultBranch}`,
	]);
	if (ancestor.exitCode !== 0) {
		throw new NonFastForwardCanonicalError(
			`canonical root cannot fast-forward to origin/${defaultBranch}`,
		);
	}
};

export const fastForwardCanonicalDefault = async (
	git: GitRunner,
	root: string,
	defaultBranch: string,
): Promise<void> => {
	await assertCanonicalCanFastForward(git, root, defaultBranch);
	await git.run(["-C", root, "merge", "--ff-only", `origin/${defaultBranch}`]);
};

export const resolveBaseRef = async (
	git: GitRunner,
	root: string,
	base: string,
): Promise<string> => {
	if (base.startsWith("origin/")) {
		const remoteName = base.slice("origin/".length);
		const remoteRef =
			(await git.runRaw(["-C", root, "show-ref", "--verify", `refs/remotes/origin/${remoteName}`]))
				.exitCode === 0;
		if (remoteRef) return base;
	}
	const local =
		(await git.runRaw(["-C", root, "show-ref", "--verify", `refs/heads/${base}`])).exitCode === 0;
	if (local) return base;
	const remote =
		(await git.runRaw(["-C", root, "show-ref", "--verify", `refs/remotes/origin/${base}`]))
			.exitCode === 0;
	if (remote) return `origin/${base}`;
	throw new UsageError(`base branch not found locally or on origin: ${base}`);
};

export const assertBranchHasMergedUpstream = async (
	git: GitRunner,
	root: string,
	branch: string,
): Promise<void> => {
	const upstream = await git.runRaw([
		"-C",
		root,
		"rev-parse",
		"--abbrev-ref",
		`${branch}@{upstream}`,
	]);
	if (upstream.exitCode !== 0 || upstream.stdout.trim() === "") {
		throw new UnmergedBranchError(`branch ${branch} has no upstream; pass --force to recycle`);
	}
	const upstreamRef = upstream.stdout.trim();
	const merged = await git.runRaw(["-C", root, "merge-base", "--is-ancestor", branch, upstreamRef]);
	if (merged.exitCode !== 0) {
		throw new UnmergedBranchError(
			`branch ${branch} is not merged to ${upstreamRef}; pass --force to recycle`,
		);
	}
};

export const assertBranchIntegratedInto = async (options: {
	git: GitRunner;
	root: string;
	worktreePath: string;
	branch: string;
	integratedInto: string;
}): Promise<void> => {
	const { git, root, worktreePath, branch, integratedInto } = options;
	const dirty = await git.runRaw(["-C", worktreePath, "status", "--porcelain=v1"]);
	if (dirty.stdout.trim() !== "") {
		throw new DirtyWorktreeError(`worktree ${worktreePath} has uncommitted changes`);
	}

	const source = await resolveCommitRef(git, root, `refs/heads/${branch}`, "source branch");
	const target = await resolveCommitRef(git, root, integratedInto, "--integrated-into");
	if (source === target) {
		throw new UnmergedBranchError(`branch ${branch} cannot be proven integrated into itself`);
	}
	const mergeBase = await git.runRaw(["-C", root, "merge-base", source, target]);
	if (mergeBase.exitCode !== 0 || mergeBase.stdout.trim() === "") {
		throw new UnmergedBranchError(`branch ${branch} and ${integratedInto} have no common ancestor`);
	}
	const base = mergeBase.stdout.trim();
	const changedPaths = await git.runRaw(["-C", root, "diff", "--name-only", "-z", base, source]);
	const paths = changedPaths.stdout.split("\0").filter((path) => path !== "");
	if (paths.length === 0) {
		throw new UnmergedBranchError(`branch ${branch} has no changes to prove integrated`);
	}
	const equivalent = await git.runRaw([
		"-C",
		root,
		"diff",
		"--quiet",
		source,
		target,
		"--",
		...paths,
	]);
	if (equivalent.exitCode === 0) return;
	if (equivalent.exitCode === 1) {
		throw new UnmergedBranchError(
			`branch ${branch} is not content-equivalent to ${integratedInto}; refusing to remove it`,
		);
	}
	throw new HoneycombError(
		`could not compare branch ${branch} with ${integratedInto}: ${equivalent.stderr.trim()}`,
	);
};

const resolveCommitRef = async (
	git: GitRunner,
	root: string,
	ref: string,
	label: string,
): Promise<string> => {
	const resolved = await git.runRaw([
		"-C",
		root,
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${ref}^{commit}`,
	]);
	if (resolved.exitCode !== 0 || resolved.stdout.trim() === "") {
		throw new UsageError(`${label} must name an existing commit: ${ref}`);
	}
	return resolved.stdout.trim();
};

export const assertBranchSafelyDeletable = async (
	git: GitRunner,
	root: string,
	branch: string,
): Promise<void> => {
	const upstream = await git.runRaw([
		"-C",
		root,
		"rev-parse",
		"--abbrev-ref",
		`${branch}@{upstream}`,
	]);
	const mergeTarget = upstream.exitCode === 0 ? upstream.stdout.trim() : "HEAD";
	const merged = await git.runRaw(["-C", root, "merge-base", "--is-ancestor", branch, mergeTarget]);
	if (merged.exitCode !== 0)
		throw new UnmergedBranchError(`branch ${branch} is not merged; pass --force to remove it`);
};
