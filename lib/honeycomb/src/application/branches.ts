import {
	DirtyCanonicalError,
	DirtyWorktreeError,
	EXIT_CODES,
	HoneycombError,
	NonFastForwardCanonicalError,
	TrunkDetectionError,
	UnmergedBranchError,
	UsageError,
	WrongCanonicalBranchError,
} from "../errors.ts";
import { parseTrunkFromRemoteShow, parseTrunkFromSymbolicRef } from "../git/worktrees.ts";
import type { AddPolicy } from "../domain/config.ts";
import type { BranchState } from "../domain/worktree.ts";
import type { GitRunner } from "../services.ts";

/** Git diff reports differing content with exit status one. */
const DIFF_FOUND = 1;
const NO_PATHS = 0;

interface ComparisonRequest {
	/** Branch whose integration is being verified. */
	branch: string;
	/** Injected Git process boundary. */
	git: GitRunner;
	/** Integration target named in refusal diagnostics. */
	integratedInto: string;
	/** Repository containing the compared refs. */
	root: string;
	/** Source commit or ref for the comparison. */
	source: string;
	/** Target commit or ref that must contain the source changes. */
	target: string;
}

export async function detectBranchState(
	git: GitRunner,
	root: string,
	branch: string,
): Promise<BranchState> {
	const refs = await git.runRaw([
		"-C",
		root,
		"for-each-ref",
		"--format=%(refname)",
		"refs/heads",
		"refs/remotes/origin",
	]);
	return branchStateFromRefs(refs.stdout.split("\n"), branch);
}

export async function detectOriginDefaultBranch(git: GitRunner, root: string): Promise<string> {
	const symbolic = await git.runRaw(["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD"]);
	const fromSymbolic =
		symbolic.exitCode === EXIT_CODES.SUCCESS && parseTrunkFromSymbolicRef(symbolic.stdout);
	if (fromSymbolic) {
		return fromSymbolic;
	}
	const remoteShow = await git.runRaw(["-C", root, "remote", "show", "origin"]);
	const fromRemoteShow =
		remoteShow.exitCode === EXIT_CODES.SUCCESS && parseTrunkFromRemoteShow(remoteShow.stdout);
	if (fromRemoteShow) {
		return fromRemoteShow;
	}
	throw new TrunkDetectionError("couldn't determine origin default branch");
}

export async function resolveDefaultBaseForNewBranch(options: {
	git: GitRunner;
	root: string;
	policy: AddPolicy;
	branchState: BranchState;
	base: string | null;
}): Promise<string | null> {
	const { git, root, policy, branchState, base } = options;
	if (branchState !== "none") {
		// oxlint-disable-next-line unicorn/no-null -- public result type signals "no base needed" with null
		return null;
	}
	if (base) {
		return base;
	}
	const defaultBranch = await detectOriginDefaultBranch(git, root);
	if (policy !== "fresh_canonical") {
		return `origin/${defaultBranch}`;
	}
	await fastForwardCanonicalDefault(git, root, defaultBranch);
	return defaultBranch;
}

export async function assertCanonicalCanFastForward(
	git: GitRunner,
	root: string,
	defaultBranch: string,
): Promise<void> {
	await assertCanonicalClean(git, root);
	const current = await git.run(["-C", root, "branch", "--show-current"]);
	if (current.stdout.trim() !== defaultBranch) {
		throw new WrongCanonicalBranchError(
			`canonical root must be checked out on ${defaultBranch}; currently on ${current.stdout.trim() || "detached HEAD"}`,
		);
	}
	await assertHeadIsAncestorOf(git, root, `origin/${defaultBranch}`);
}

export async function fastForwardCanonicalDefault(
	git: GitRunner,
	root: string,
	defaultBranch: string,
): Promise<void> {
	await assertCanonicalCanFastForward(git, root, defaultBranch);
	await git.run(["-C", root, "merge", "--ff-only", `origin/${defaultBranch}`]);
}

export async function resolveBaseRef(git: GitRunner, root: string, base: string): Promise<string> {
	if (base.startsWith("origin/")) {
		const remoteName = base.slice("origin/".length);
		if (await refExists(git, root, `refs/remotes/origin/${remoteName}`)) {
			return base;
		}
	}
	if (await refExists(git, root, `refs/heads/${base}`)) {
		return base;
	}
	if (await refExists(git, root, `refs/remotes/origin/${base}`)) {
		return `origin/${base}`;
	}
	throw new UsageError(`base branch not found locally or on origin: ${base}`);
}

export async function assertBranchHasMergedUpstream(
	git: GitRunner,
	root: string,
	branch: string,
): Promise<void> {
	const upstream = await readBranchUpstream(git, root, branch);
	if (upstream.exitCode !== EXIT_CODES.SUCCESS || upstream.stdout.trim() === "") {
		throw new UnmergedBranchError(`branch ${branch} has no upstream; pass --force to recycle`);
	}
	const upstreamRef = upstream.stdout.trim();
	const merged = await git.runRaw(["-C", root, "merge-base", "--is-ancestor", branch, upstreamRef]);
	if (merged.exitCode !== EXIT_CODES.SUCCESS) {
		throw new UnmergedBranchError(
			`branch ${branch} is not merged to ${upstreamRef}; pass --force to recycle`,
		);
	}
}

export async function assertBranchIntegratedInto(options: {
	git: GitRunner;
	root: string;
	worktreePath: string;
	branch: string;
	integratedInto: string;
}): Promise<void> {
	const { git, root, worktreePath, branch, integratedInto } = options;
	const dirty = await git.runRaw(["-C", worktreePath, "status", "--porcelain=v1"]);
	if (dirty.stdout.trim() !== "") {
		throw new DirtyWorktreeError(`worktree ${worktreePath} has uncommitted changes`);
	}
	const source = await resolveCommitRef({
		git,
		label: "source branch",
		ref: `refs/heads/${branch}`,
		root,
	});
	const target = await resolveCommitRef({
		git,
		label: "--integrated-into",
		ref: integratedInto,
		root,
	});
	const paths = await changedPathsBetween({ branch, git, integratedInto, root, source, target });
	await assertContentEquivalent({ branch, git, integratedInto, paths, root, source, target });
}

export async function assertBranchSafelyDeletable(
	git: GitRunner,
	root: string,
	branch: string,
): Promise<void> {
	const upstream = await readBranchUpstream(git, root, branch);
	let mergeTarget = "HEAD";
	if (upstream.exitCode === EXIT_CODES.SUCCESS) {
		mergeTarget = upstream.stdout.trim();
	}
	const merged = await git.runRaw(["-C", root, "merge-base", "--is-ancestor", branch, mergeTarget]);
	if (merged.exitCode !== EXIT_CODES.SUCCESS) {
		throw new UnmergedBranchError(`branch ${branch} is not merged; pass --force to remove it`);
	}
}

export async function refExists(git: GitRunner, root: string, ref: string): Promise<boolean> {
	const result = await git.runRaw(["-C", root, "show-ref", "--verify", ref]);
	return result.exitCode === EXIT_CODES.SUCCESS;
}
// --- Private functions ---

function branchStateFromRefs(lines: string[], branch: string): BranchState {
	const local = lines.includes(`refs/heads/${branch}`);
	const remote = lines.includes(`refs/remotes/origin/${branch}`);
	if (local && remote) {
		return "local-remote";
	}
	if (local) {
		return "local";
	}
	if (remote) {
		return "remote";
	}
	return "none";
}

async function resolveCommitRef(options: {
	git: GitRunner;
	label: string;
	ref: string;
	root: string;
}): Promise<string> {
	const { git, label, ref, root } = options;
	const resolved = await git.runRaw([
		"-C",
		root,
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${ref}^{commit}`,
	]);
	if (resolved.exitCode !== EXIT_CODES.SUCCESS || resolved.stdout.trim() === "") {
		throw new UsageError(`${label} must name an existing commit: ${ref}`);
	}
	return resolved.stdout.trim();
}

async function assertCanonicalClean(git: GitRunner, root: string): Promise<void> {
	const status = await git.run(["-C", root, "status", "--porcelain=v1"]);
	if (status.stdout.trim() !== "") {
		throw new DirtyCanonicalError("canonical root has uncommitted changes");
	}
}

async function assertHeadIsAncestorOf(git: GitRunner, root: string, ref: string): Promise<void> {
	const ancestor = await git.runRaw(["-C", root, "merge-base", "--is-ancestor", "HEAD", ref]);
	if (ancestor.exitCode !== EXIT_CODES.SUCCESS) {
		throw new NonFastForwardCanonicalError(`canonical root cannot fast-forward to ${ref}`);
	}
}

async function resolveIntegrationBase(options: ComparisonRequest): Promise<string> {
	const { branch, git, integratedInto, root, source, target } = options;
	if (source === target) {
		throw new UnmergedBranchError(`branch ${branch} cannot be proven integrated into itself`);
	}
	const mergeBase = await git.runRaw(["-C", root, "merge-base", source, target]);
	if (mergeBase.exitCode !== EXIT_CODES.SUCCESS || mergeBase.stdout.trim() === "") {
		throw new UnmergedBranchError(`branch ${branch} and ${integratedInto} have no common ancestor`);
	}
	return mergeBase.stdout.trim();
}

async function changedPathsBetween(options: ComparisonRequest): Promise<string[]> {
	const { branch, git, integratedInto, root, source, target } = options;
	const base = await resolveIntegrationBase({ branch, git, integratedInto, root, source, target });
	const changedPaths = await git.runRaw(["-C", root, "diff", "--name-only", "-z", base, source]);
	const paths = changedPaths.stdout.split("\0").filter((path) => path !== "");
	if (paths.length === NO_PATHS) {
		throw new UnmergedBranchError(`branch ${branch} has no changes to prove integrated`);
	}
	return paths;
}

async function assertContentEquivalent(
	options: ComparisonRequest & { paths: string[] },
): Promise<void> {
	const { branch, git, integratedInto, paths, root, source, target } = options;
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
	if (equivalent.exitCode === EXIT_CODES.SUCCESS) {
		return;
	}
	if (equivalent.exitCode === DIFF_FOUND) {
		throw new UnmergedBranchError(
			`branch ${branch} is not content-equivalent to ${integratedInto}; refusing to remove it`,
		);
	}
	throw new HoneycombError(
		`could not compare branch ${branch} with ${integratedInto}: ${equivalent.stderr.trim()}`,
	);
}

function readBranchUpstream(git: GitRunner, root: string, branch: string) {
	return git.runRaw(["-C", root, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
}
