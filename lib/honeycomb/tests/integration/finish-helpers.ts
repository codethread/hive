import { gitOut, gitText } from "./lifecycle-helpers.ts";
import { pathExists } from "./support.ts";

export interface FinishFixture {
	/** Source branch retained even during a stopped rebase. */
	branch: string;
	/** Bare origin fixture. */
	remote: string;
	/** Canonical checkout. */
	root: string;
	/** Source checkout. */
	worktreePath: string;
}

export async function readCheckoutState(repo: string) {
	return {
		head: await gitOut(repo, "rev-parse", "HEAD"),
		index: await gitText(repo, "ls-files", "--stage"),
		status: await gitOut(repo, "status", "--porcelain=v1"),
	};
}

export async function readFinishState(fixture: FinishFixture) {
	return {
		canonical: await readCheckoutState(fixture.root),
		remoteHead: await gitOut(fixture.remote, "rev-parse", "HEAD"),
		sourceBranchHead: await gitOut(fixture.root, "rev-parse", `refs/heads/${fixture.branch}`),
		sourceExists: await pathExists(fixture.worktreePath),
	};
}

export function finishPolicy(strategy: string, fresh = false, cleanup = false): string {
	let policy = "";
	if (fresh) {
		policy = '[project.add]\npolicy = "fresh_canonical"\n';
	}
	policy += `[project.finish]\nstrategy = "${strategy}"\n`;
	if (cleanup) {
		policy += "push = true\nremove_worktree = true\ndelete_branch = true\n";
	}
	return policy;
}

export function finishArgs(worktreePath: string, strategy: string): string[] {
	const args = ["--cwd", worktreePath, "--json"];
	if (strategy === "squash") {
		args.push("--title", "chore: integrate source work");
	}
	return args;
}
