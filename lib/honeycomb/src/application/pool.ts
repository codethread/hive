import { resolve } from "node:path";
import {
	type ProjectConfig,
	type TreesConfig,
	type WorktreeLocation,
	projectNameFor,
} from "../domain/config.ts";
import {
	type PoolState,
	type Slot,
	type Worktree,
	worktreePathForName,
} from "../domain/worktree.ts";

import { BlockedError, ConfigError, DirtySlotError, UsageError } from "../errors.ts";
import type { Deps, GitRunner, WorkspaceFiles } from "../services.ts";
import {
	assertBranchHasMergedUpstream,
	assertBranchIntegratedInto,
	detectOriginDefaultBranch,
} from "./branches.ts";
import { runBootstrap } from "./hooks.ts";
import { listWorktrees } from "./repository.ts";

export const buildPoolState = async (
	cfg: ProjectConfig,
	worktrees: Worktree[],
	deps: { git: GitRunner; files: Pick<WorkspaceFiles, "normalizePath" | "exists"> },
	location: WorktreeLocation = cfg.worktreeLocation ?? "sibling",
): Promise<PoolState> => {
	const { git, files } = deps;
	if (!cfg.poolSize) throw new ConfigError(`project ${cfg.name ?? cfg.root} is not pooled`);
	const root = files.normalizePath(cfg.root);
	const trunk = await detectOriginDefaultBranch(git, root);
	const slots = await Promise.all(
		Array.from({ length: cfg.poolSize }, (_, offset) =>
			buildPoolSlotState({
				index: offset + 1,
				root,
				files,
				location,
				worktrees,
				git,
			}),
		),
	);
	return { root, trunk, hasPool: true, size: cfg.poolSize, slots };
};

const buildPoolSlotState = async (options: {
	index: number;
	root: string;
	location: WorktreeLocation;
	worktrees: Worktree[];
	git: GitRunner;
	files: Pick<WorkspaceFiles, "exists">;
}): Promise<Slot> => {
	const { index, root, location, worktrees, git, files } = options;
	const matches = worktrees.filter(
		(candidate) => !candidate.canonical && candidate.pool?.index === index,
	);
	if (matches.length > 1) {
		throw new BlockedError(
			`multiple worktrees claim pool slot feat${index}: ${matches.map((candidate) => candidate.path).join(", ")}`,
		);
	}
	const worktree = matches[0];
	const slotPath = worktree?.path ?? worktreePathForName(root, `feat${index}`, location);
	if (!worktree) {
		return {
			index,
			path: slotPath,
			exists: false,
			branch: null,
			placeholder: false,
			dirty: false,
			lastCommitIso: null,
			lastCommitSubject: null,
			initialized: false,
		};
	}

	const branch = worktree.branch;
	const [status, log, marker] = await Promise.all([
		git.runRaw(["-C", slotPath, "status", "--porcelain=v1"]),
		git.runRaw(["-C", slotPath, "log", "-1", "--format=%cI%x1f%s"]),
		git.runRaw(["-C", slotPath, "rev-parse", "--git-path", "wk-pool-initialized"]),
	]);
	const [lastCommitIso, lastCommitSubject] =
		log.exitCode === 0 && log.stdout.trim() !== ""
			? log.stdout.trimEnd().split("\x1f", 2)
			: [null, null];
	return {
		index,
		path: slotPath,
		exists: true,
		branch,
		placeholder: branch === `wk-pool/feat${index}`,
		dirty: status.stdout.trim() !== "",
		lastCommitIso,
		lastCommitSubject,
		initialized: marker.exitCode === 0 && files.exists(resolve(slotPath, marker.stdout.trim())),
	};
};

export const recycleSlot = async (options: {
	files: WorkspaceFiles;
	git: GitRunner;
	project: ProjectConfig;
	root: string;
	slotPath: string;
	force: boolean;
	keepBranch: boolean;
	integratedInto: string | null;
	worktreeLocation: WorktreeLocation;
}): Promise<void> => {
	const {
		git,
		files,
		project,
		root,
		slotPath,
		force,
		keepBranch,
		integratedInto,
		worktreeLocation,
	} = options;
	const normalizedSlotPath = files.normalizePath(slotPath);
	const worktrees = await listWorktrees(git, root);
	const state = await buildPoolState(project, worktrees, { git, files }, worktreeLocation);
	const slot = state.slots.find(
		(candidate) => files.normalizePath(candidate.path) === normalizedSlotPath,
	);
	if (!slot?.exists) throw new UsageError(`pool slot not found: ${slotPath}`);
	const placeholderBranch = `wk-pool/feat${slot.index}`;
	const oldBranch = slot.branch;
	await git.run(["-C", root, "fetch", "origin"]);
	if (force) {
		await git.run([
			"-C",
			slot.path,
			"checkout",
			"-f",
			"-B",
			placeholderBranch,
			`origin/${state.trunk}`,
		]);
		await git.run(["-C", slot.path, "reset", "--hard", placeholderBranch]);
		await git.run(["-C", slot.path, "clean", "-fd"]);
		if (oldBranch && oldBranch !== placeholderBranch && !keepBranch)
			await git.run(["-C", root, "branch", "-D", oldBranch]);
		return;
	}

	const dirty =
		(await git.runRaw(["-C", slot.path, "status", "--porcelain=v1"])).stdout.trim() !== "";
	if (dirty)
		throw new DirtySlotError(`slot ${slot.path} has uncommitted changes; pass --force to recycle`);
	if (oldBranch && oldBranch !== placeholderBranch && !keepBranch) {
		if (integratedInto) {
			await assertBranchIntegratedInto({
				git,
				root,
				worktreePath: slot.path,
				branch: oldBranch,
				integratedInto,
			});
		} else {
			await assertBranchHasMergedUpstream(git, root, oldBranch);
		}
	}
	await git.run(["-C", slot.path, "checkout", "-B", placeholderBranch, `origin/${state.trunk}`]);
	if (oldBranch && oldBranch !== placeholderBranch && !keepBranch)
		await git.run(["-C", root, "branch", integratedInto ? "-D" : "-d", oldBranch]);
};

export const ensurePool = async (
	project: ProjectConfig,
	deps: Deps,
	initialWorktrees: Worktree[] | undefined,
	config: TreesConfig,
	resolvedCommand?: string | null,
): Promise<PoolState> => {
	const { files } = deps;
	if (!project.poolSize) {
		return {
			root: files.normalizePath(project.root),
			trunk: "",
			hasPool: false,
			size: 0,
			slots: [],
		};
	}
	const root = files.normalizePath(project.root);
	const command = resolvedCommand ?? deps.config.explain(config, root).command.command;
	const worktreeLocation = deps.config.explain(config, root).worktreeLocation;
	let worktrees = initialWorktrees ?? (await listWorktrees(deps.git, root));
	let state = await buildPoolState(project, worktrees, deps, worktreeLocation);
	const needsWork = state.slots.some((slot) => !slot.exists || !slot.initialized);
	if (!needsWork) return state;

	await deps.git.run(["-C", root, "fetch", "origin"]);
	for (const slot of state.slots) {
		if (slot.exists && slot.initialized) continue;
		const branch = `wk-pool/feat${slot.index}`;
		deps.progress.banner(`[wk-pool] initializing feat${slot.index}…`);
		await ensurePlaceholderBranch({ git: deps.git, root, branch, trunk: state.trunk });
		const createdWorktree = !slot.exists;
		if (createdWorktree) {
			await deps.files.prepareParent(root, slot.path, worktreeLocation);
			await deps.git.run(["-C", root, "worktree", "add", slot.path, branch]);
		}
		if (!command)
			throw new ConfigError(
				`project ${project.name ?? project.root} requires command for pooled setup`,
			);
		try {
			await deps.files.copy(root, slot.path, project.copy);
			await runBootstrap(deps, {
				projectName: projectNameFor(project, root),
				command,
				root,
				created: slot.path,
				pooled: true,
			});
		} catch (error) {
			if (createdWorktree)
				await deps.git.runRaw(["-C", root, "worktree", "remove", "--force", slot.path]);
			throw error;
		}
		worktrees = await listWorktrees(deps.git, root);
		state = await buildPoolState(project, worktrees, deps, worktreeLocation);
	}
	return state;
};

export const ensurePlaceholderBranch = async (options: {
	git: GitRunner;
	root: string;
	branch: string;
	trunk: string;
}): Promise<void> => {
	const { git, root, branch, trunk } = options;
	const exists =
		(await git.runRaw(["-C", root, "show-ref", "--verify", `refs/heads/${branch}`])).exitCode === 0;
	if (!exists) await git.run(["-C", root, "branch", branch, `origin/${trunk}`]);
};

export const describeSlotRisk = async (
	git: GitRunner,
	slot: Slot,
): Promise<{ ahead: number; behind: number; localOnly: boolean }> => {
	const upstream = await git.runRaw(["-C", slot.path, "rev-parse", "--abbrev-ref", "@{upstream}"]);
	if (upstream.exitCode !== 0 || upstream.stdout.trim() === "")
		return { ahead: 0, behind: 0, localOnly: true };
	const counts = await git.runRaw([
		"-C",
		slot.path,
		"rev-list",
		"--left-right",
		"--count",
		`${upstream.stdout.trim()}...HEAD`,
	]);
	const [behind, ahead] = counts.stdout
		.trim()
		.split(/\s+/)
		.map((value) => Number(value));
	return { ahead: ahead || 0, behind: behind || 0, localOnly: false };
};
