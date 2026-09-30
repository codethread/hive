import {
	assertBranchIntegratedInto,
	assertBranchSafelyDeletable,
} from "../application/branches.ts";
import { planLeaveWorktree } from "../application/interactive.ts";
import { ensurePool, recycleSlot } from "../application/pool.ts";
import { runPreRemoteCheck } from "../application/hooks.ts";
import { listWorktrees, resolveRemoveTarget } from "../application/repository.ts";
import { CanonicalRootError, UsageError, HoneycombError, withFailureContext } from "../errors.ts";
import {
	finalizeReadyResult,
	parseOptions,
	parseOutputMode,
	requireOption,
	toRemovePayload,
} from "../protocol.ts";
import type { Deps } from "../services.ts";

export const removeCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	const branch = typeof opts.branch === "string" ? opts.branch : null;
	const self = opts.self === true;
	const force = opts.force === true;
	const interactive = opts.interactive === true;
	const keepBranch = opts["keep-branch"] === true;
	const integratedInto =
		typeof opts["integrated-into"] === "string" ? opts["integrated-into"] : null;
	if ((branch && self) || (!branch && !self)) {
		throw new UsageError("provide exactly one of --branch or --self");
	}
	if (integratedInto && keepBranch) {
		throw new UsageError("--integrated-into cannot be combined with --keep-branch");
	}
	if (integratedInto && force) {
		throw new UsageError("--integrated-into cannot be combined with --force");
	}
	if (integratedInto && !integratedInto.startsWith("origin/")) {
		throw new UsageError("--integrated-into must name an origin remote-tracking ref");
	}

	let targetPath: string | undefined;
	try {
		let worktrees = await listWorktrees(deps.git, cwd);
		const canonical = worktrees.find((worktree) => worktree.canonical);
		if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
		const config = deps.config.read();
		const project = deps.config.explain(config, canonical.path).project;
		const worktreeLocation = deps.config.explain(config, canonical.path).worktreeLocation;
		if (integratedInto || project?.poolSize) {
			await runPreRemoteCheck(deps, {
				config,
				root: canonical.path,
				operation: "honeycomb remove",
			});
		}
		if (integratedInto) await deps.git.run(["-C", canonical.path, "fetch", "origin"]);
		if (project?.poolSize) {
			await ensurePool(project, deps, worktrees, config);
			worktrees = await listWorktrees(deps.git, cwd);
		}
		const target = resolveRemoveTarget(
			worktrees,
			canonical.path,
			cwd,
			{ branch, self },
			deps.files,
		);
		targetPath = target.path;
		if (deps.files.normalizePath(target.path) === deps.files.normalizePath(canonical.path)) {
			throw new CanonicalRootError("refusing to remove canonical root");
		}
		const afterOutput = interactive
			? planLeaveWorktree(deps, { cwd, root: canonical.path, worktreePath: target.path })
			: undefined;
		if (project?.poolSize && target.pool) {
			await recycleSlot({
				files: deps.files,
				git: deps.git,
				project,
				root: canonical.path,
				slotPath: target.path,
				force,
				keepBranch,
				integratedInto,
				worktreeLocation,
			});
			return finalizeReadyResult(
				toRemovePayload({ worktreePath: target.path, removed: false }),
				output,
				`honeycomb: recycled pool slot at ${target.path}`,
				afterOutput,
			);
		}

		if (target.branch && !force && !keepBranch) {
			if (integratedInto) {
				await assertBranchIntegratedInto({
					git: deps.git,
					root: canonical.path,
					worktreePath: target.path,
					branch: target.branch,
					integratedInto,
				});
			} else {
				await assertBranchSafelyDeletable(deps.git, canonical.path, target.branch);
			}
		}
		await deps.git.run([
			"-C",
			canonical.path,
			"worktree",
			"remove",
			...(force ? ["--force"] : []),
			target.path,
		]);
		if (target.branch && !keepBranch) {
			await deps.git.run([
				"-C",
				canonical.path,
				"branch",
				force || integratedInto ? "-D" : "-d",
				target.branch,
			]);
		}

		const payload = toRemovePayload({
			worktreePath: target.path,
			removed: !deps.files.exists(target.path),
		});
		return finalizeReadyResult(
			payload,
			output,
			payload.removed
				? `honeycomb: removed worktree at ${payload.worktree_path}`
				: `honeycomb: recycled pool slot at ${payload.worktree_path}`,
			afterOutput,
		);
	} catch (error) {
		throw withFailureContext(error, {
			branch: branch ?? undefined,
			worktree_path: targetPath,
		});
	}
};
