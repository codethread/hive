import type { AddPolicy, FinishStrategy } from "../domain/config.ts";
import {
	DirtyWorktreeError,
	EXIT_CODES,
	FinishConflictError,
	TargetNotFreshError,
	UsageError,
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
	/** Ref that integration must update. */
	targetRef: string;
}

/** Validated integration inputs: squash needs a caller title, other strategies none. */
type IntegrationPlan =
	| {
			/** Configured non-squash strategy; carries no message inputs. */
			strategy: Exclude<FinishStrategy, "squash">;
	  }
	| {
			/** Squash integration strategy. */
			strategy: "squash";
			/** Caller-supplied squash commit subject. */
			title: string;
			/** Caller-supplied squash commit body; undefined when omitted. */
			body: string | undefined;
	  };

/** Narrowed squash inputs accepted by the squash integrator. */
type SquashIntegration = Extract<IntegrationPlan, { strategy: "squash" }>;

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

const integrateSquash = async (
	options: IntegrateOptions,
	integration: SquashIntegration,
): Promise<void> => {
	const message = composeSquashCommitMessage({
		body: integration.body,
		messages: await readSourceCommitMessages(options),
		sourceBranch: options.sourceBranch,
		title: integration.title,
	});
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
	const commit = await options.git.runRaw(["-C", options.canonicalPath, "commit", "-m", message]);
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
		mergeCommitMessage(options.sourceBranch),
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

const integrateSource = async (
	options: IntegrateOptions,
	integration: IntegrationPlan,
): Promise<void> => {
	switch (integration.strategy) {
		case "ff_only": {
			await integrateFastForward(options);
			return;
		}
		case "squash": {
			await integrateSquash(options, integration);
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

/** Validated integration inputs: squash requires a caller title, other strategies none. */
const parseIntegrationPlan = (
	strategy: FinishStrategy,
	title: string | boolean | undefined,
	body: string | boolean | undefined,
): IntegrationPlan => {
	const normalizedTitle = normalizedText(title);
	const normalizedBody = normalizedText(body);
	if (strategy !== "squash") {
		if (normalizedTitle !== undefined || normalizedBody !== undefined) {
			throw new UsageError("--title and --body require finish strategy squash");
		}
		return { strategy };
	}
	if (normalizedTitle === undefined) {
		throw new UsageError("missing required --title");
	}
	return { body: normalizedBody, strategy, title: normalizedTitle };
};

const normalizedText = (value: string | boolean | undefined): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed === "") {
		return undefined;
	}
	return trimmed;
};

const mergeCommitMessage = (sourceBranch: string): string =>
	`chore: merge worktree\n\nSource branch:\n${sourceBranch.match(/.{1,40}/gu)?.join("\n") ?? sourceBranch}`;

/** Squash message sections: caller text, branch provenance, then the squashed history. */
const composeSquashCommitMessage = (options: {
	title: string;
	body: string | undefined;
	sourceBranch: string;
	messages: readonly string[];
}): string => {
	const { title, body, sourceBranch, messages } = options;
	const sections = [title];
	if (body) {
		sections.push(body);
	}
	sections.push(`Source branch: ${sourceBranch}`, ...messages);
	return sections.join("\n\n");
};

/** Source commit messages in the range being squashed, oldest first. */
const readSourceCommitMessages = async (options: {
	git: GitRunner;
	canonicalPath: string;
	targetRef: string;
	sourceBranch: string;
}): Promise<string[]> => {
	const log = await options.git.run([
		"-C",
		options.canonicalPath,
		"log",
		"--reverse",
		"--format=%B%x00",
		`${options.targetRef}..${options.sourceBranch}`,
	]);
	return log.stdout
		.split("\0")
		.map((message) => message.trim())
		.filter((message) => message !== "");
};

export {
	assertCleanSource,
	assertFinishTargetReady,
	assertSourceCanFastForwardTarget,
	integrateSource,
	parseIntegrationPlan,
	type IntegrationPlan,
};
