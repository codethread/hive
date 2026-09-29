import { buildPoolState, ensurePool } from "../application/pool.ts";
import { runPreRemoteCheck } from "../application/hooks.ts";
import {
	listWorktrees,
	resolveCanonicalRoot,
	resolveWorktreeContainingPath,
} from "../application/repository.ts";
import { encodeBranch, worktreePathForName } from "../domain/worktree.ts";
import {
	BlockedError,
	CanonicalRootError,
	EXIT_CODES,
	UsageError,
	HoneycombError,
} from "../errors.ts";
import {
	type OutputMode,
	finalizeReadyResult,
	formatCommandSource,
	formatWorktreeList,
	parseOptions,
	parseOutputMode,
	requireOption,
	toBlockedCommandResult,
	toConfigExplainPayload,
	toListJson,
	withMachineJsonProgress,
} from "../protocol.ts";

import type { Deps } from "../services.ts";

export const rootCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const canonicalRoot = await resolveCanonicalRoot(deps.git, cwd);
	return { stdout: `${canonicalRoot}\n`, exitCode: 0 };
};

export const listCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	const machineDeps = withMachineJsonProgress(deps, output);
	try {
		const config = deps.config.read();
		const canonicalRoot = await resolveCanonicalRoot(machineDeps.git, cwd);
		const project = deps.config.explain(config, canonicalRoot).project;
		if (project?.poolSize) {
			await runPreRemoteCheck(deps, { config, root: canonicalRoot, operation: "honeycomb list" });
			await ensurePool(project, machineDeps, undefined, config);
		}
		const worktrees = await listWorktrees(machineDeps.git, cwd);
		if (output.json)
			return { stdout: `${JSON.stringify(worktrees.map(toListJson), null, 2)}\n`, exitCode: 0 };
		return { stdout: formatWorktreeList(worktrees), exitCode: 0 };
	} catch (error) {
		const blocked = toBlockedCommandResult(error, output, {});
		if (blocked) return blocked;
		throw error;
	}
};

export const pathCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const branch = requireOption(opts, "branch");
	const config = deps.config.read();
	const worktrees = await listWorktrees(deps.git, cwd);
	const canonical = worktrees.find((worktree) => worktree.canonical);
	if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
	const existing = worktrees.find((worktree) => worktree.branch === branch);
	if (existing) return { stdout: `${existing.path}\n`, exitCode: 0 };

	const project = deps.config.explain(config, canonical.path).project;
	const worktreeLocation = deps.config.explain(config, canonical.path).worktreeLocation;
	if (project?.poolSize) {
		await runPreRemoteCheck(deps, { config, root: canonical.path, operation: "honeycomb path" });
		const state = await buildPoolState(project, worktrees, deps, worktreeLocation);
		const slot = state.slots.find((candidate) => candidate.branch === branch);
		if (!slot) throw new BlockedError(`no pooled worktree found for branch ${branch}`);
		return { stdout: `${slot.path}\n`, exitCode: 0 };
	}
	return {
		stdout: `${worktreePathForName(canonical.path, encodeBranch(branch), worktreeLocation)}\n`,
		exitCode: 0,
	};
};

export const ensureCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const worktrees = await listWorktrees(deps.git, cwd);
	const canonical = worktrees.find((worktree) => worktree.canonical);
	if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
	const config = deps.config.read();
	const project = deps.config.explain(config, canonical.path).project;
	if (project?.poolSize) {
		await runPreRemoteCheck(deps, { config, root: canonical.path, operation: "honeycomb ensure" });
		await ensurePool(project, deps, worktrees, config);
	}
	return { exitCode: 0 };
};

export const statusCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output: OutputMode = { json: true };
	try {
		const worktrees = await listWorktrees(deps.git, cwd);
		const canonical = worktrees.find((worktree) => worktree.canonical);
		if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
		const config = deps.config.read();
		const project = deps.config.explain(config, canonical.path).project;
		if (!project?.poolSize) {
			return {
				stdout: `${JSON.stringify({ root: canonical.path, trunk: null, hasPool: false, size: 0, slots: [] }, null, 2)}\n`,
				exitCode: 0,
			};
		}
		await runPreRemoteCheck(deps, { config, root: canonical.path, operation: "honeycomb status" });
		const worktreeLocation = deps.config.explain(config, canonical.path).worktreeLocation;
		const state = await buildPoolState(project, worktrees, deps, worktreeLocation);
		return { stdout: `${JSON.stringify(state, null, 2)}\n`, exitCode: 0 };
	} catch (error) {
		const blocked = toBlockedCommandResult(error, output, {});
		if (blocked) return blocked;
		throw error;
	}
};

export const copyCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	try {
		const config = deps.config.read();
		const worktrees = await listWorktrees(deps.git, cwd);
		const canonical = worktrees.find((worktree) => worktree.canonical);
		if (!canonical) throw new HoneycombError("couldn't determine canonical worktree");
		const target = resolveWorktreeContainingPath(worktrees, cwd, deps.files);
		if (!target) throw new UsageError(`no worktree contains cwd: ${cwd}`);
		if (deps.files.normalizePath(target.path) === deps.files.normalizePath(canonical.path)) {
			throw new CanonicalRootError("refusing to copy setup into canonical root");
		}
		const project = deps.config.explain(config, canonical.path).project;
		const copied = await deps.files.copy(canonical.path, target.path, project?.copy ?? []);
		const payload = {
			kind: "ready",
			root: canonical.path,
			worktree_path: target.path,
			copied,
			exclude_paths: [...new Set(copied.map((entry) => entry.to))].sort(),
		};
		return finalizeReadyResult(
			payload,
			output,
			`honeycomb: copied ${payload.copied.length} items into ${payload.worktree_path}`,
		);
	} catch (error) {
		const blocked = toBlockedCommandResult(error, output, {});
		if (blocked) return blocked;
		throw error;
	}
};

export const configCommand = async (args: string[], deps: Deps) => {
	const [topic, ...rest] = args;
	if (topic !== "explain") throw new UsageError("expected config explain");
	const opts = parseOptions(rest);
	const cwd = requireOption(opts, "cwd");
	const output = parseOutputMode(opts);
	const canonicalRoot = await resolveCanonicalRoot(deps.git, cwd);
	const explanation = deps.config.explain(deps.config.read(), canonicalRoot);
	const payload = toConfigExplainPayload(explanation);
	if (output.json)
		return { stdout: `${JSON.stringify(payload, null, 2)}\n`, exitCode: EXIT_CODES.SUCCESS };
	const matchedRules = payload.matched_rules.map((rule) => rule.root_glob).join(", ") || "(none)";
	const project = payload.project
		? `${payload.project.name ?? "(unnamed)"} ${payload.project.root}`
		: "(none)";
	return {
		stdout: `root: ${payload.root}\nmatched_rules: ${matchedRules}\nproject: ${project}\ncommand.source: ${formatCommandSource(payload.command.source)}\npre_remote_check.source: ${formatCommandSource(payload.pre_remote_check.source)}\nworktree_location: ${payload.worktree_location}\nadd.policy: ${payload.add.policy}\nfinish.enabled: ${payload.finish.enabled}\nfinish.strategy: ${payload.finish.strategy}\nfinish.push: ${payload.finish.push}\nfinish.remove_worktree: ${payload.finish.remove_worktree}\nfinish.delete_branch: ${payload.finish.delete_branch}\n`,
		exitCode: EXIT_CODES.SUCCESS,
	};
};
