import {
	detectBranchState,
	detectOriginDefaultBranch,
	resolveBaseRef,
	resolveDefaultBaseForNewBranch,
} from "../application/branches.ts";
import { focusWorktree } from "../application/interactive.ts";
import {
	buildPoolState,
	describeSlotRisk,
	ensurePlaceholderBranch,
	ensurePool,
	recycleSlot,
} from "../application/pool.ts";
import { runBootstrap, runPreRemoteCheck } from "../application/hooks.ts";
import {
	listWorktrees,
	resolveCanonicalRoot,
	resolveWorktreeContainingPath,
} from "../application/repository.ts";
import {
	type ProjectConfig,
	type TreesConfig,
	type WorktreeLocation,
	projectNameFor,
} from "../domain/config.ts";
import {
	type AddPlan,
	type BranchState,
	type PoolState,
	type Slot,
	encodeBranch,
	worktreePathForName,
} from "../domain/worktree.ts";

import {
	BlockedError,
	CanonicalRootError,
	ConfigError,
	DuplicateBranchError,
	EXIT_CODES,
	PickerCancelled,
	ReservedPrefixError,
	UsageError,
	HoneycombError,
	withFailureContext,
} from "../errors.ts";
import {
	type CommandResult,
	type OutputMode,
	type PoolFullPayload,
	type ReadyAddPayload,
	finalizeReadyResult,
	finalizeStructuredResult,
	parseOptions,
	parseOutputMode,
	requireOption,
	toAddPayload,
} from "../protocol.ts";

import type { Deps, GitRunner, PickerItem, ProgressReporter } from "../services.ts";

export const addCommand = async (args: string[], deps: Deps) => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const branch = requireOption(opts, "branch");
	const output = parseOutputMode(opts);
	const slotPath = typeof opts.slot === "string" ? opts.slot : null;
	const baseOption = typeof opts.base === "string" ? opts.base : null;
	const baseCurrent = opts["base-current"] === true;
	if (baseCurrent && baseOption !== null) {
		throw new UsageError("--base-current cannot be combined with --base");
	}
	const interactive = opts.interactive === true;
	if (branch.startsWith("wk-pool/")) {
		throw new ReservedPrefixError("branch names starting with wk-pool/ are reserved");
	}

	try {
		const canonicalRoot = await resolveCanonicalRoot(deps.git, cwd);
		const config = deps.config.read();
		const project = deps.config.explain(config, canonicalRoot).project;
		const worktreeLocation = deps.config.explain(config, canonicalRoot).worktreeLocation;
		const effectiveCommand = deps.config.explain(config, canonicalRoot).command;
		const worktrees = await listWorktrees(deps.git, canonicalRoot);
		const existing = worktrees.find((worktree) => worktree.branch === branch);
		if (existing) {
			throw new DuplicateBranchError(`branch ${branch} is already checked out at ${existing.path}`);
		}
		const currentWorktree = baseCurrent
			? resolveWorktreeContainingPath(worktrees, cwd, deps.files)
			: null;
		if (baseCurrent && !currentWorktree?.branch) {
			throw new UsageError(
				"--base-current requires the worktree containing --cwd to be on a branch",
			);
		}
		const base = currentWorktree?.branch ?? baseOption;
		if (slotPath && !project?.poolSize) {
			throw new UsageError("--slot is only valid for pooled projects");
		}
		await runPreRemoteCheck(deps, { config, root: canonicalRoot, operation: "honeycomb add" });
		if (project?.poolSize) {
			return addPooledWorktree({
				deps,
				project,
				config,
				root: canonicalRoot,
				branch,
				slotPath,
				output,
				base,
				force: opts.force === true,
				command: effectiveCommand.command,
				worktreeLocation,
				interactive,
			});
		}

		const worktreePath = worktreePathForName(canonicalRoot, encodeBranch(branch), worktreeLocation);
		if (deps.files.normalizePath(worktreePath) === deps.files.normalizePath(canonicalRoot)) {
			throw new CanonicalRootError("refusing to use canonical root as worktree target");
		}

		await deps.git.run(["-C", canonicalRoot, "fetch", "origin"]);
		const branchState = await detectBranchState(deps.git, canonicalRoot, branch);
		const defaultBase = await resolveDefaultBaseForNewBranch({
			git: deps.git,
			root: canonicalRoot,
			policy: deps.config.explain(config, canonicalRoot).addPolicy,
			branchState,
			base,
		});
		const originalBranchHead = await captureExistingBranchHead({
			git: deps.git,
			root: canonicalRoot,
			branch,
			branchState,
		});
		await deps.files.prepareParent(canonicalRoot, worktreePath, worktreeLocation);
		await addNonPoolWorktree({
			git: deps.git,
			root: canonicalRoot,
			path: worktreePath,
			branch,
			state: branchState,
			base: base ?? defaultBase,
			progress: deps.progress,
		});
		try {
			await mergeOriginIfPresent({
				git: deps.git,
				worktreePath,
				branch,
				progress: deps.progress,
			});
			if (project) {
				await deps.files.copy(canonicalRoot, worktreePath, project.copy);
			}
			if (effectiveCommand.command) {
				await runBootstrap(deps, {
					projectName: projectNameFor(project, canonicalRoot),
					command: effectiveCommand.command,
					root: canonicalRoot,
					created: worktreePath,
					pooled: false,
				});
			}
		} catch (error) {
			await rollbackNonPoolAdd({
				git: deps.git,
				root: canonicalRoot,
				worktreePath,
				branch,
				branchState,
				originalBranchHead,
			});
			throw error;
		}

		const plan: AddPlan = {
			worktreePath,
			branch,
			root: canonicalRoot,
			title: branch,
			createdNewBranch: branchState === "none" || branchState === "remote",
			rollbackBranchHead: originalBranchHead,
		};
		return finalizeReadyAdd({ payload: toAddPayload(plan), output, deps, interactive });
	} catch (error) {
		throw withFailureContext(error, {
			branch,
			slot_path: slotPath ?? undefined,
		});
	}
};

const addPooledWorktree = async (options: {
	deps: Deps;
	project: ProjectConfig;
	config: TreesConfig;
	root: string;
	branch: string;
	slotPath: string | null;
	output: OutputMode;
	base: string | null;
	force: boolean;
	command: string | null;
	worktreeLocation: WorktreeLocation;
	interactive: boolean;
}): Promise<CommandResult> => {
	const {
		deps,
		project,
		config,
		root,
		branch,
		slotPath,
		output,
		base,
		force,
		command,
		worktreeLocation,
		interactive,
	} = options;
	let worktrees = await listWorktrees(deps.git, root);
	for (const worktree of worktrees) {
		if (worktree.branch === branch) {
			throw new DuplicateBranchError(`branch ${branch} is already checked out at ${worktree.path}`);
		}
	}
	await deps.git.run(["-C", root, "fetch", "origin"]);
	const branchState = await detectBranchState(deps.git, root, branch);
	const defaultBase = await resolveDefaultBaseForNewBranch({
		git: deps.git,
		root,
		policy: deps.config.explain(config, root).addPolicy,
		branchState,
		base,
	});
	await ensurePool(project, deps, worktrees, config, command);
	worktrees = await listWorktrees(deps.git, root);
	for (const worktree of worktrees) {
		if (worktree.branch === branch) {
			throw new DuplicateBranchError(`branch ${branch} is already checked out at ${worktree.path}`);
		}
	}
	let state = await buildPoolState(project, worktrees, deps, worktreeLocation);

	if (slotPath) {
		const selected = state.slots.find(
			(candidate) =>
				deps.files.normalizePath(candidate.path) === deps.files.normalizePath(slotPath),
		);
		if (!selected?.exists) throw new UsageError(`pool slot not found: ${slotPath}`);
		if (!selected.initialized)
			throw new BlockedError(`pool slot is not initialized: ${selected.path}`);
		let targetSlot = selected;
		if (!targetSlot.placeholder) {
			await recycleSlot({
				files: deps.files,
				git: deps.git,
				project,
				root,
				slotPath: targetSlot.path,
				force,
				keepBranch: false,
				integratedInto: null,
				worktreeLocation,
			});
			state = await buildPoolState(
				project,
				await listWorktrees(deps.git, root),
				deps,
				worktreeLocation,
			);
			targetSlot =
				state.slots.find((candidate) => candidate.index === selected.index) ?? targetSlot;
		}
		return finalizeReadyAdd({
			payload: await allocatePooledSlot({
				deps,
				project,
				root,
				slot: targetSlot,
				branch,
				branchState,
				base: base ?? defaultBase,
				command,
			}),
			output,
			deps,
			interactive,
		});
	}

	const slot = state.slots.find(
		(candidate) => candidate.exists && candidate.initialized && candidate.placeholder,
	);
	if (slot) {
		return finalizeReadyAdd({
			payload: await allocatePooledSlot({
				deps,
				project,
				root,
				slot,
				branch,
				branchState,
				base: base ?? defaultBase,
				command,
			}),
			output,
			deps,
			interactive,
		});
	}

	if (output.json) {
		return finalizeStructuredResult(
			await toPoolFullPayload(deps.git, state, branch),
			output,
			EXIT_CODES.BLOCKED,
		);
	}

	const selected = await pickFullPoolSlot({ deps, state, interactive });
	if (!force) {
		const confirmed = await deps.picker.confirm(
			await buildRecycleConfirmPrompt(deps.git, selected),
		);
		if (!confirmed) throw new PickerCancelled();
	}
	await recycleSlot({
		files: deps.files,
		git: deps.git,
		project,
		root,
		slotPath: selected.path,
		force: true,
		keepBranch: false,
		integratedInto: null,
		worktreeLocation,
	});
	state = await buildPoolState(
		project,
		await listWorktrees(deps.git, root),
		deps,
		worktreeLocation,
	);
	const recycled = state.slots.find((candidate) => candidate.index === selected.index);
	if (!recycled) throw new HoneycombError(`pool slot disappeared after recycle: ${selected.path}`);
	return finalizeReadyAdd({
		payload: await allocatePooledSlot({
			deps,
			project,
			root,
			slot: recycled,
			branch,
			branchState,
			base: base ?? defaultBase,
			command,
		}),
		output,
		deps,
		interactive,
	});
};

const finalizeReadyAdd = (options: {
	payload: ReadyAddPayload;
	output: OutputMode;
	deps: Deps;
	interactive: boolean;
}): CommandResult =>
	finalizeReadyResult(
		options.payload,
		options.output,
		`honeycomb: added ${options.payload.branch} at ${options.payload.worktree_path}`,
		options.interactive
			? () =>
					focusWorktree(options.deps, {
						path: options.payload.worktree_path,
						title: options.payload.title,
					})
			: undefined,
	);

const allocatePooledSlot = async (options: {
	deps: Deps;
	project: ProjectConfig;
	root: string;
	slot: Slot;
	branch: string;
	branchState: BranchState;
	base: string | null;
	command: string | null;
}): Promise<ReadyAddPayload> => {
	const { deps, project, root, slot, branch, branchState, base, command } = options;
	if (!command)
		throw new ConfigError(
			`project ${project.name ?? project.root} requires command for pooled setup`,
		);
	const originalBranchHead = await captureExistingBranchHead({
		git: deps.git,
		root,
		branch,
		branchState,
	});
	await checkoutBranchInSlot({
		git: deps.git,
		slotPath: slot.path,
		branch,
		state: branchState,
		base,
		progress: deps.progress,
	});
	try {
		await mergeOriginIfPresent({
			git: deps.git,
			worktreePath: slot.path,
			branch,
			progress: deps.progress,
		});
		await deps.files.copy(root, slot.path, project.copy);
		await runBootstrap(deps, {
			projectName: projectNameFor(project, root),
			command,
			root,
			created: slot.path,
			pooled: true,
		});
	} catch (error) {
		await rollbackPooledAllocation({
			git: deps.git,
			root,
			slot,
			branch,
			branchState,
			originalBranchHead,
		});
		throw error;
	}
	const plan: AddPlan = {
		worktreePath: slot.path,
		branch,
		root,
		title: branch,
		createdNewBranch: branchState === "none" || branchState === "remote",
		rollbackBranchHead: originalBranchHead,
	};
	return toAddPayload(plan);
};

const pickFullPoolSlot = async (options: {
	deps: Deps;
	state: PoolState;
	interactive: boolean;
}): Promise<Slot> => {
	const { deps, state, interactive } = options;
	const candidates = state.slots.filter(
		(slot) => slot.exists && slot.initialized && !slot.placeholder,
	);
	const firstCandidate = candidates[0];
	if (!firstCandidate) throw new HoneycombError("pool full; no recyclable slots found");
	const items: PickerItem[] = [];
	for (const slot of candidates) {
		const risk = await describeSlotRisk(deps.git, slot);
		items.push({
			key: String(slot.index),
			display: `${slot.path}\tfeat${slot.index}  ${slot.branch ?? "(detached)"}  ${formatRelativeAge(slot.lastCommitIso, deps.clock.now())}${slot.dirty ? "  [dirty]" : ""}${risk.ahead > 0 ? `  [${risk.ahead} ahead]` : ""}${risk.localOnly ? "  [local-only]" : ""}`,
			preview: buildPickerPreview(),
		});
	}
	const selected = await deps.picker.pick(items, "Select a worktree slot to recycle", {
		interactive,
	});
	return candidates.find((slot) => String(slot.index) === selected.key) ?? firstCandidate;
};

const buildPickerPreview = (): string =>
	`slot={1}; counts=$(git -C "$slot" rev-list --left-right --count @{upstream}...HEAD 2>/dev/null); if [ $? -ne 0 ] || [ -z "$counts" ]; then echo '⚠ local-only branch'; else ahead=$(echo "$counts" | awk '{print $2}'); [ "$ahead" -gt 0 ] 2>/dev/null && echo "⚠ $ahead unpushed commits will be lost"; echo "upstream: $(echo "$counts" | awk '{print $1}') behind, $ahead ahead"; fi; git -C "$slot" log -5 --format='%h %s'; git -C "$slot" status --porcelain | head`;

const buildRecycleConfirmPrompt = async (git: GitRunner, slot: Slot): Promise<string> => {
	const risk = await describeSlotRisk(git, slot);
	const warnings = [
		slot.dirty ? "dirty changes will be lost" : null,
		risk.localOnly ? "local-only branch" : null,
		risk.ahead > 0 ? `⚠ ${risk.ahead} unpushed commits will be lost` : null,
	]
		.filter(Boolean)
		.join("; ");
	return `Recycle feat${slot.index} (${slot.branch ?? "detached"})${warnings ? `: ${warnings}` : ""}? [y/N] `;
};

const formatRelativeAge = (iso: string | null, now: number): string => {
	if (!iso) return "unknown";
	const ageMs = now - Date.parse(iso);
	const days = Math.floor(ageMs / 86_400_000);
	if (days > 0) return `${days}d ago`;
	const hours = Math.floor(ageMs / 3_600_000);
	return hours > 0 ? `${hours}h ago` : "now";
};

const captureExistingBranchHead = async (options: {
	git: GitRunner;
	root: string;
	branch: string;
	branchState: BranchState;
}): Promise<string | null> => {
	const { git, root, branch, branchState } = options;
	if (branchState !== "local" && branchState !== "local-remote") return null;
	const result = await git.run(["-C", root, "rev-parse", `refs/heads/${branch}`]);
	return result.stdout.trim();
};

const restoreBranchRef = async (options: {
	git: GitRunner;
	root: string;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, branch, branchState, originalBranchHead } = options;
	if (branchState === "none" || branchState === "remote") {
		await git.runRaw(["-C", root, "branch", "-D", branch]);
		return;
	}
	if (originalBranchHead)
		await git.runRaw(["-C", root, "branch", "-f", branch, originalBranchHead]);
};

const rollbackNonPoolAdd = async (options: {
	git: GitRunner;
	root: string;
	worktreePath: string;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, worktreePath, branch, branchState, originalBranchHead } = options;
	await git.runRaw(["-C", root, "worktree", "remove", "--force", worktreePath]);
	await restoreBranchRef({ git, root, branch, branchState, originalBranchHead });
};

const rollbackPooledAllocation = async (options: {
	git: GitRunner;
	root: string;
	slot: Slot;
	branch: string;
	branchState: BranchState;
	originalBranchHead: string | null;
}): Promise<void> => {
	const { git, root, slot, branch, branchState, originalBranchHead } = options;
	const trunk = await detectOriginDefaultBranch(git, root);
	const placeholderBranch = `wk-pool/feat${slot.index}`;
	await ensurePlaceholderBranch({ git, root, branch: placeholderBranch, trunk });
	await git.runRaw(["-C", slot.path, "checkout", "-f", "-B", placeholderBranch, `origin/${trunk}`]);
	await git.runRaw(["-C", slot.path, "reset", "--hard", placeholderBranch]);
	await git.runRaw(["-C", slot.path, "clean", "-fd"]);
	await restoreBranchRef({ git, root, branch, branchState, originalBranchHead });
};

const addNonPoolWorktree = async (options: {
	git: GitRunner;
	root: string;
	path: string;
	branch: string;
	state: BranchState;
	base: string | null;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, root, path, branch, state, base, progress } = options;
	if (state !== "none" && base) progress.error("--base ignored: branch already exists");
	if (state === "local" || state === "local-remote") {
		await git.run(["-C", root, "worktree", "add", path, branch]);
		return;
	}
	if (state === "remote") {
		await git.run([
			"-C",
			root,
			"worktree",
			"add",
			"--no-track",
			"-b",
			branch,
			path,
			`origin/${branch}`,
		]);
		return;
	}
	const startPoint = base ? await resolveBaseRef(git, root, base) : "HEAD";
	await git.run(["-C", root, "worktree", "add", "--no-track", "-b", branch, path, startPoint]);
};

const checkoutBranchInSlot = async (options: {
	git: GitRunner;
	slotPath: string;
	branch: string;
	state: BranchState;
	base: string | null;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, slotPath, branch, state, base, progress } = options;
	if (state !== "none" && base) progress.error("--base ignored: branch already exists");
	if (state === "local" || state === "local-remote") {
		await git.run(["-C", slotPath, "checkout", branch]);
		return;
	}
	if (state === "remote") {
		await git.run(["-C", slotPath, "checkout", "--no-track", "-B", branch, `origin/${branch}`]);
		return;
	}
	const startPoint = base ? await resolveBaseRef(git, slotPath, base) : "HEAD";
	await git.run(["-C", slotPath, "checkout", "--no-track", "-B", branch, startPoint]);
};

const mergeOriginIfPresent = async (options: {
	git: GitRunner;
	worktreePath: string;
	branch: string;
	progress: ProgressReporter;
}): Promise<void> => {
	const { git, worktreePath, branch, progress } = options;
	const remoteExists =
		(
			await git.runRaw([
				"-C",
				worktreePath,
				"show-ref",
				"--verify",
				`refs/remotes/origin/${branch}`,
			])
		).exitCode === 0;
	if (!remoteExists) return;
	const merge = await git.runRaw(["-C", worktreePath, "merge", "--ff-only", `origin/${branch}`]);
	if (merge.exitCode !== 0)
		progress.error(`warning: couldn't fast-forward from origin/${branch}; preserving local work`);
};

const toPoolFullPayload = async (
	git: GitRunner,
	state: PoolState,
	branch: string,
): Promise<PoolFullPayload> => {
	const candidates = state.slots.filter(
		(slot) => slot.exists && slot.initialized && !slot.placeholder,
	);
	return {
		kind: "pool_full",
		root: state.root,
		branch,
		candidates: await Promise.all(
			candidates.map(async (slot) => {
				const risk = await describeSlotRisk(git, slot);
				return {
					slot: slot.index,
					path: slot.path,
					branch: slot.branch,
					dirty: slot.dirty,
					ahead: risk.ahead,
					local_only: risk.localOnly,
					last_commit_iso: slot.lastCommitIso,
					last_commit_subject: slot.lastCommitSubject,
				};
			}),
		),
	};
};
