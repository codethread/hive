import { listWorktrees, resolveWorktreeContainingPath } from "../application/repository.ts";
import type { Worktree } from "../domain/worktree.ts";
import { EXIT_CODES, HoneycombError, PickerCancelled, UsageError } from "../errors.ts";
import { gitLogPreviewCommand, openRequestForWorktree } from "../integrations/multiplexer.ts";
import { type CommandResult, parseOptions, requireOption } from "../protocol.ts";
import type { Deps, PickerItem } from "../services.ts";

/** Fuzzy-pick a worktree and print its path; interactively, open its session or hand the path to the shell. */
export const pickCommand = async (args: string[], deps: Deps): Promise<CommandResult> => {
	const opts = parseOptions(args);
	const cwd = requireOption(opts, "cwd");
	const interactive = opts.interactive === true;
	const open = opts.open === true;
	if (open && !interactive) throw new UsageError("pick --open requires --interactive");
	if (open && !deps.multiplexer.attached) {
		throw new UsageError("pick --open requires a terminal multiplexer session");
	}

	const worktrees = (await listWorktrees(deps.git, cwd)).filter((worktree) => !worktree.bare);
	const current = resolveWorktreeContainingPath(worktrees, cwd, deps.files);
	// Only an interactive invocation may reach into the multiplexer for session previews.
	const preview = interactive ? deps.multiplexer.previewCommand() : gitLogPreviewCommand();
	const items = worktrees.map((worktree) => ({
		key: worktree.path,
		display: `${worktree.path}\t${worktree === current ? "*" : " "} ${worktreeTitle(worktree)}`,
		preview,
	}));
	let selected: PickerItem;
	try {
		selected = await deps.picker.pick(items, "Select a worktree", { interactive });
	} catch (error) {
		// Cancelling is a normal outcome for a human picker, so exit quietly.
		if (error instanceof PickerCancelled) return { exitCode: EXIT_CODES.CANCELLED };
		throw error;
	}
	const worktree = worktrees.find((candidate) => candidate.path === selected.key);
	if (!worktree) throw new HoneycombError(`picker returned unknown worktree ${selected.key}`);

	if (open) {
		await deps.multiplexer.open(openRequestForWorktree(worktree.path, worktreeTitle(worktree)));
		return { exitCode: EXIT_CODES.SUCCESS };
	}
	if (interactive) deps.cdDirective.write(worktree.path);
	return { stdout: `${worktree.path}\n`, exitCode: EXIT_CODES.SUCCESS };
};

const worktreeTitle = (worktree: Worktree): string => worktree.branch ?? "(detached)";
