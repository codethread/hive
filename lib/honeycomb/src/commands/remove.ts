import {
	assertBranchIntegratedInto,
	assertBranchSafelyDeletable,
} from "../application/branches.ts";
import { ensurePool, recycleSlot } from "../application/pool.ts";
import { runPreRemoteCheck } from "../application/preflight.ts";
import { listWorktrees, resolveRemoveTarget } from "../application/repository.ts";
import { CanonicalRootError, UsageError, HoneycombError } from "../errors.ts";
import {
	finalizeStructuredResult,
	parseOptions,
	parseOutputMode,
	requireOption,
	toBlockedCommandResult,
	toRemovePayload,
	withMachineJsonProgress,
} from "../protocol.ts";
import type { Deps } from "../services.ts";

export const removeCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	const machineDeps = withMachineJsonProgress(deps, output);
	const branch = typeof opts.branch === "string" ? opts.branch : null;
	const self = typeof opts.self === "string" ? opts.self : null;
	const force = opts.force === true;
	const keepBranch = opts["keep-branch"] === true;
	const integratedInto =
		typeof opts["integrated-into"] === "string" ? opts["integrated-into"] : null;
	const skipPreRemoteCheck = opts["skip-pre-remote-check"] === true && deps.internalRollback;
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
		let worktrees = await listWorktrees(machineDeps.git, cwd);
		const canonical = worktrees.find((worktree) => worktree.canonical);
		if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
		const config = deps.config.read();
		const project = deps.config.explain(config, canonical.path).project;
		const worktreeLocation = deps.config.explain(config, canonical.path).worktreeLocation;
		if ((integratedInto || project?.poolSize) && !skipPreRemoteCheck) {
			await runPreRemoteCheck(deps, {
				config,
				root: canonical.path,
				operation: "honeycomb remove",
			});
		}
		if (integratedInto) await machineDeps.git.run(["-C", canonical.path, "fetch", "origin"]);
		if (project?.poolSize) {
			await ensurePool(project, machineDeps, worktrees, config);
			worktrees = await listWorktrees(machineDeps.git, cwd);
		}
		const target = resolveRemoveTarget(worktrees, canonical.path, { branch, self }, deps.files);
		targetPath = target.path;
		if (deps.files.normalizePath(target.path) === deps.files.normalizePath(canonical.path)) {
			throw new CanonicalRootError("refusing to remove canonical root");
		}
		if (project?.poolSize && target.pool) {
			await recycleSlot({
				files: deps.files,
				git: machineDeps.git,
				project,
				root: canonical.path,
				slotPath: target.path,
				force,
				keepBranch,
				integratedInto,
				worktreeLocation,
			});
			return finalizeStructuredResult(
				toRemovePayload({ worktreePath: target.path, removed: false }),
				output,
			);
		}

		if (target.branch && !force && !keepBranch) {
			if (integratedInto) {
				await assertBranchIntegratedInto({
					git: machineDeps.git,
					root: canonical.path,
					worktreePath: target.path,
					branch: target.branch,
					integratedInto,
				});
			} else {
				await assertBranchSafelyDeletable(machineDeps.git, canonical.path, target.branch);
			}
		}
		await machineDeps.git.run([
			"-C",
			canonical.path,
			"worktree",
			"remove",
			...(force ? ["--force"] : []),
			target.path,
		]);
		if (target.branch && !keepBranch) {
			await machineDeps.git.run([
				"-C",
				canonical.path,
				"branch",
				force || integratedInto ? "-D" : "-d",
				target.branch,
			]);
		}

		return finalizeStructuredResult(
			toRemovePayload({ worktreePath: target.path, removed: !deps.files.exists(target.path) }),
			output,
		);
	} catch (error) {
		const blocked = toBlockedCommandResult(error, output, {
			branch: branch ?? undefined,
			worktree_path: targetPath,
		});
		if (blocked) return blocked;
		throw error;
	}
};
