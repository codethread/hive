import type { BranchState, PoolState, Slot, Worktree } from "../domain/worktree.ts";
import {
	ConfigError,
	DirtySlotError,
	DuplicateBranchError,
	HoneycombError,
	PickerCancelled,
	UsageError,
} from "../errors.ts";
import type { PoolFullPayload, ReadyAddPayload } from "../protocol.ts";
import type { ProjectConfig, TreesConfig, WorktreeLocation } from "../domain/config.ts";
import {
	addNonPoolWorktree,
	captureExistingBranchHead,
	checkoutBranchInSlot,
	mergeOriginIfPresent,
	prepareAddBranch,
	rollbackNonPoolAdd,
	rollbackPooledAllocation,
} from "./add-worktree.ts";
import { buildPoolState, recycleSlot } from "../application/pool.ts";
import {
	buildRecycleConfirmPrompt,
	pickFullPoolSlot,
	toPoolFullPayload,
} from "./add-pool-picker.ts";
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
	/** Pool observations before allocation. */
	state: PoolState;
}
interface Allocation extends PreparedPool {
	/** Selected slot to prepare and allocate. */
	slot: Slot;
}

export async function addPooledWorktree(
	options: PooledAddOptions,
): Promise<ReadyAddPayload | PoolFullPayload> {
	const prepared = await preparePooledAdd(options);
	if (options.slotPath) {
		const slot = await selectExplicitSlot(prepared, options.slotPath);
		return allocatePooledSlot({ ...prepared, slot });
	}
	return allocateAvailableSlot(prepared);
}
// --- Private functions ---

function assertBranchAvailable(worktrees: Worktree[], branch: string): void {
	const existing = worktrees.find((worktree) => worktree.branch === branch);
	if (existing) {
		throw new DuplicateBranchError(`branch ${branch} is already checked out at ${existing.path}`);
	}
}

async function inspectPool(options: PooledAddOptions): Promise<PoolState> {
	const { deps, project, root, worktreeLocation } = options;
	const worktrees = await listWorktrees(deps.git, root);
	assertBranchAvailable(worktrees, options.branch);
	return buildPoolState({ deps, location: worktreeLocation, project, worktrees });
}

async function preparePooledAdd(options: PooledAddOptions): Promise<PreparedPool> {
	const { base, branch, config, deps, root } = options;
	const worktrees = await listWorktrees(deps.git, root);
	assertBranchAvailable(worktrees, branch);
	const preparedBranch = await prepareAddBranch({ base, branch, config, deps, root });
	const state = await inspectPool(options);
	return { ...options, ...preparedBranch, state };
}

async function populatePooledSlot(options: Allocation & { command: string }): Promise<void> {
	const { branch, command, deps, project, root, slot } = options;
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
}

async function allocatePooledSlot(options: Allocation): Promise<ReadyAddPayload> {
	const { branch, branchState, command, deps, project, root, slot } = options;
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
	await checkoutPooledSlot(options);
	try {
		await populatePooledSlot({ ...options, command });
	} catch (error) {
		await rollbackSelectedSlot({ ...options, originalBranchHead });
		throw error;
	}
	return toAddPayload({
		branch,
		createdNewBranch: branchState === "none" || branchState === "remote",
		rollbackBranchHead: originalBranchHead,
		root,
		title: branch,
		worktreePath: slot.path,
	});
}

async function checkoutPooledSlot(options: Allocation): Promise<void> {
	const { base, branch, branchState, deps, root, slot } = options;
	if (!slot.exists || !slot.initialized) {
		deps.progress.banner(`[wk-pool] initializing feat${slot.index}…`);
	}
	if (slot.exists) {
		await checkoutBranchInSlot({
			base,
			branch,
			git: deps.git,
			progress: deps.progress,
			slotPath: slot.path,
			state: branchState,
		});
		return;
	}
	await deps.files.prepareParent(root, slot.path, options.worktreeLocation);
	await addNonPoolWorktree({
		base,
		branch,
		git: deps.git,
		path: slot.path,
		progress: deps.progress,
		root,
		state: branchState,
	});
}

async function rollbackSelectedSlot(
	options: Allocation & { originalBranchHead: string | null },
): Promise<void> {
	const { branch, branchState, deps, originalBranchHead, root, slot } = options;
	const rollback = { branch, branchState, git: deps.git, originalBranchHead, root };
	if (slot.exists) {
		await rollbackPooledAllocation({ ...rollback, slot });
		return;
	}
	await rollbackNonPoolAdd({ ...rollback, worktreePath: slot.path });
}

async function recycleAndReadSlot(
	options: PreparedPool,
	selected: Slot,
	force: boolean,
): Promise<Slot | undefined> {
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
}

async function selectExplicitSlot(options: PreparedPool, slotPath: string): Promise<Slot> {
	const { deps, state } = options;
	const selected = state.slots.find(
		(candidate) => deps.files.normalizePath(candidate.path) === deps.files.normalizePath(slotPath),
	);
	if (!selected) {
		throw new UsageError(`pool slot not found: ${slotPath}`);
	}
	if (!selected.exists || (selected.placeholder && !selected.dirty)) {
		return selected;
	}
	if (selected.placeholder && !options.force) {
		throw new DirtySlotError(
			`slot ${selected.path} has uncommitted changes; pass --force to recycle`,
		);
	}
	return (await recycleAndReadSlot(options, selected, options.force)) ?? selected;
}

async function confirmRecycle(options: PreparedPool, selected: Slot): Promise<void> {
	if (options.force) {
		return;
	}
	const confirmed = await options.deps.picker.confirm(
		await buildRecycleConfirmPrompt(options.deps.git, selected),
	);
	if (!confirmed) {
		throw new PickerCancelled();
	}
}

async function recycleFullPoolSlot(options: PreparedPool): Promise<Slot> {
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
}

async function allocateAvailableSlot(
	options: PreparedPool,
): Promise<ReadyAddPayload | PoolFullPayload> {
	const slot =
		options.state.slots.find(
			(candidate) =>
				candidate.exists && candidate.initialized && candidate.placeholder && !candidate.dirty,
		) ??
		options.state.slots.find(
			(candidate) => !candidate.exists || (candidate.placeholder && !candidate.dirty),
		);
	if (slot) {
		return allocatePooledSlot({ ...options, slot });
	}
	if (options.json) {
		return toPoolFullPayload(options.deps.git, options.state, options.branch);
	}
	const recycled = await recycleFullPoolSlot(options);
	return allocatePooledSlot({ ...options, slot: recycled });
}
