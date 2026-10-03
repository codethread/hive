import {
	BlockedError,
	ConfigError,
	DuplicateBranchError,
	HoneycombError,
	PickerCancelled,
	UsageError,
} from "../errors.ts";
import type { BranchState, PoolState, Slot, Worktree } from "../domain/worktree.ts";
import type { PoolFullPayload, ReadyAddPayload } from "../protocol.ts";
import type { ProjectConfig, TreesConfig, WorktreeLocation } from "../domain/config.ts";
import { buildPoolState, ensurePool, recycleSlot } from "../application/pool.ts";
import {
	buildRecycleConfirmPrompt,
	pickFullPoolSlot,
	toPoolFullPayload,
} from "./add-pool-picker.ts";
import {
	captureExistingBranchHead,
	checkoutBranchInSlot,
	mergeOriginIfPresent,
	prepareAddBranch,
	rollbackPooledAllocation,
} from "./add-worktree.ts";
import type { Deps } from "../services.ts";
import { listWorktrees } from "../application/repository.ts";
import { projectNameFor } from "../domain/config.ts";
import { runBootstrap } from "../application/hooks.ts";
import { toAddPayload } from "../protocol.ts";

interface PooledAddOptions {
	/** Branch base requested by the caller. */
	base: string | null;
	/** Branch being allocated. */
	branch: string;
	/** Resolved bootstrap command. */
	command: string | null;
	/** Loaded configuration. */
	config: TreesConfig;
	/** Injected command services. */
	deps: Deps;
	/** Whether to force recycling. */
	force: boolean;
	/** Whether picker UI is interactive. */
	interactive: boolean;
	/** Whether full pools produce JSON rather than a picker. */
	json: boolean;
	/** Configured pooled project. */
	project: ProjectConfig;
	/** Canonical repository root. */
	root: string;
	/** Explicit slot override, if requested. */
	slotPath: string | null;
	/** Placement of new pool worktrees. */
	worktreeLocation: WorktreeLocation;
}
interface PreparedPool extends PooledAddOptions {
	/** Branch state observed after fetch. */
	branchState: BranchState;
	/** Pool observations after initialization. */
	state: PoolState;
}
interface Allocation extends PreparedPool {
	/** Selected initialized slot. */
	slot: Slot;
}

const assertBranchAvailable = (worktrees: Worktree[], branch: string): void => {
	const existing = worktrees.find((worktree) => worktree.branch === branch);
	if (existing) {
		throw new DuplicateBranchError(`branch ${branch} is already checked out at ${existing.path}`);
	}
};

const inspectInitializedPool = async (options: PooledAddOptions): Promise<PoolState> => {
	const { deps, project, root, worktreeLocation } = options;
	const worktrees = await listWorktrees(deps.git, root);
	assertBranchAvailable(worktrees, options.branch);
	return buildPoolState({ deps, location: worktreeLocation, project, worktrees });
};

const preparePooledAdd = async (options: PooledAddOptions): Promise<PreparedPool> => {
	const { base, branch, command, config, deps, project, root } = options;
	const worktrees = await listWorktrees(deps.git, root);
	assertBranchAvailable(worktrees, branch);
	const preparedBranch = await prepareAddBranch({ base, branch, config, deps, root });
	await ensurePool({
		config,
		deps,
		initialWorktrees: worktrees,
		project,
		resolvedCommand: command,
	});
	const state = await inspectInitializedPool(options);
	return { ...options, ...preparedBranch, state };
};

const populatePooledSlot = async (
	options: Allocation & { command: string; originalBranchHead: string | null },
): Promise<void> => {
	const { branch, branchState, command, deps, originalBranchHead, project, root, slot } = options;
	try {
		await mergeOriginIfPresent({
			branch,
			git: deps.git,
			progress: deps.progress,
			worktreePath: slot.path,
		});
		await deps.files.copy(root, slot.path, project.copy);
		await runBootstrap(deps, {
			command,
			created: slot.path,
			pooled: true,
			projectName: projectNameFor(project, root),
			root,
		});
	} catch (error) {
		await rollbackPooledAllocation({
			branch,
			branchState,
			git: deps.git,
			originalBranchHead,
			root,
			slot,
		});
		throw error;
	}
};

const allocatePooledSlot = async (options: Allocation): Promise<ReadyAddPayload> => {
	const { base, branch, branchState, command, deps, project, root, slot } = options;
	if (!command) {
		throw new ConfigError(
			`project ${project.name ?? project.root} requires command for pooled setup`,
		);
	}
	const originalBranchHead = await captureExistingBranchHead({
		branch,
		branchState,
		git: deps.git,
		root,
	});
	await checkoutBranchInSlot({
		base,
		branch,
		git: deps.git,
		progress: deps.progress,
		slotPath: slot.path,
		state: branchState,
	});
	await populatePooledSlot({ ...options, command, originalBranchHead });
	return toAddPayload({
		branch,
		createdNewBranch: branchState === "none" || branchState === "remote",
		rollbackBranchHead: originalBranchHead,
		root,
		title: branch,
		worktreePath: slot.path,
	});
};

const recycleAndReadSlot = async (
	options: PreparedPool,
	selected: Slot,
	force: boolean,
): Promise<Slot | undefined> => {
	const { deps, project, root, worktreeLocation } = options;
	await recycleSlot({
		files: deps.files,
		force,
		git: deps.git,
		// eslint-disable-next-line unicorn/no-null -- recycleSlot's API uses null when no integration ref is requested.
		integratedInto: null,
		keepBranch: false,
		project,
		root,
		slotPath: selected.path,
		worktreeLocation,
	});
	const state = await buildPoolState({
		deps,
		location: worktreeLocation,
		project,
		worktrees: await listWorktrees(deps.git, root),
	});
	return state.slots.find((candidate) => candidate.index === selected.index);
};

const selectExplicitSlot = async (options: PreparedPool, slotPath: string): Promise<Slot> => {
	const { deps, state } = options;
	const selected = state.slots.find(
		(candidate) => deps.files.normalizePath(candidate.path) === deps.files.normalizePath(slotPath),
	);
	if (!selected?.exists) {
		throw new UsageError(`pool slot not found: ${slotPath}`);
	}
	if (!selected.initialized) {
		throw new BlockedError(`pool slot is not initialized: ${selected.path}`);
	}
	if (selected.placeholder) {
		return selected;
	}
	return (await recycleAndReadSlot(options, selected, options.force)) ?? selected;
};

const confirmRecycle = async (options: PreparedPool, selected: Slot): Promise<void> => {
	if (options.force) {
		return;
	}
	const confirmed = await options.deps.picker.confirm(
		await buildRecycleConfirmPrompt(options.deps.git, selected),
	);
	if (!confirmed) {
		throw new PickerCancelled();
	}
};

const recycleFullPoolSlot = async (options: PreparedPool): Promise<Slot> => {
	const selected = await pickFullPoolSlot({
		deps: options.deps,
		interactive: options.interactive,
		state: options.state,
	});
	await confirmRecycle(options, selected);
	const recycled = await recycleAndReadSlot(options, selected, true);
	if (!recycled) {
		throw new HoneycombError(`pool slot disappeared after recycle: ${selected.path}`);
	}
	return recycled;
};

const allocateAvailableSlot = async (
	options: PreparedPool,
): Promise<ReadyAddPayload | PoolFullPayload> => {
	const slot = options.state.slots.find(
		(candidate) => candidate.exists && candidate.initialized && candidate.placeholder,
	);
	if (slot) {
		return allocatePooledSlot({ ...options, slot });
	}
	if (options.json) {
		return toPoolFullPayload(options.deps.git, options.state, options.branch);
	}
	const recycled = await recycleFullPoolSlot(options);
	return allocatePooledSlot({ ...options, slot: recycled });
};

const addPooledWorktree = async (
	options: PooledAddOptions,
): Promise<ReadyAddPayload | PoolFullPayload> => {
	const prepared = await preparePooledAdd(options);
	if (options.slotPath) {
		const slot = await selectExplicitSlot(prepared, options.slotPath);
		return allocatePooledSlot({ ...prepared, slot });
	}
	return allocateAvailableSlot(prepared);
};

export { addPooledWorktree };
