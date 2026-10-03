import type { Deps, PickerItem } from "../services.ts";
import { EXIT_CODES, HoneycombError, PickerCancelled, UsageError } from "../errors.ts";
import { gitLogPreviewCommand, openRequestForWorktree } from "../integrations/multiplexer.ts";
import { listWorktrees, resolveWorktreeContainingPath } from "../application/repository.ts";
import { parseOptions, requireOption } from "../protocol.ts";
import type { CommandResult } from "../protocol.ts";
import type { Worktree } from "../domain/worktree.ts";

interface PickRequest {
	/** Checkout to search from. */
	cwd: string;
	/** Whether the invocation may use multiplexer UI and shell directives. */
	interactive: boolean;
	/** Whether to open the selected worktree in the multiplexer. */
	open: boolean;
}

const parsePickRequest = (args: string[]): PickRequest => {
	const opts = parseOptions(args);
	return {
		cwd: requireOption(opts, "cwd"),
		interactive: opts.interactive === true,
		open: opts.open === true,
	};
};

const assertPickable = (request: PickRequest, deps: Deps): void => {
	if (request.open && !request.interactive) {
		throw new UsageError("pick --open requires --interactive");
	}
	if (request.open && !deps.multiplexer.attached) {
		throw new UsageError("pick --open requires a terminal multiplexer session");
	}
};

const worktreeTitle = (worktree: Worktree): string => worktree.branch ?? "(detached)";

// Only an interactive invocation may reach into the multiplexer for session previews.
const previewCommandFor = (interactive: boolean, deps: Deps): string => {
	if (interactive) {
		return deps.multiplexer.previewCommand();
	}
	return gitLogPreviewCommand();
};

const focusMarker = (focused: boolean): string => {
	if (focused) {
		return "*";
	}
	return " ";
};

const buildPickerItems = (options: {
	current: Worktree | undefined;
	preview: string;
	worktrees: Worktree[];
}): PickerItem[] =>
	options.worktrees.map((worktree) => ({
		display: `${worktree.path}\t${focusMarker(worktree === options.current)} ${worktreeTitle(worktree)}`,
		key: worktree.path,
		preview: options.preview,
	}));

const buildPickList = async (
	request: PickRequest,
	deps: Deps,
): Promise<{ items: PickerItem[]; worktrees: Worktree[] }> => {
	const listed = await listWorktrees(deps.git, request.cwd);
	const worktrees = listed.filter((worktree) => !worktree.bare);
	const current = resolveWorktreeContainingPath(worktrees, request.cwd, deps.files);
	const preview = previewCommandFor(request.interactive, deps);
	return { items: buildPickerItems({ current, preview, worktrees }), worktrees };
};

const requireSelectedWorktree = (worktrees: Worktree[], selected: PickerItem): Worktree => {
	const worktree = worktrees.find((candidate) => candidate.path === selected.key);
	if (!worktree) {
		throw new HoneycombError(`picker returned unknown worktree ${selected.key}`);
	}
	return worktree;
};

const pickSelection = async (options: {
	deps: Deps;
	interactive: boolean;
	items: PickerItem[];
}): Promise<PickerItem | undefined> => {
	try {
		return await options.deps.picker.pick(options.items, "Select a worktree", {
			interactive: options.interactive,
		});
	} catch (error) {
		// Cancelling is a normal outcome for a human picker, so exit quietly.
		if (error instanceof PickerCancelled) {
			return undefined;
		}
		throw error;
	}
};

const openOrDirect = async (options: {
	deps: Deps;
	interactive: boolean;
	open: boolean;
	worktree: Worktree;
}): Promise<CommandResult> => {
	const { deps, interactive, open, worktree } = options;
	if (open) {
		await deps.multiplexer.open(openRequestForWorktree(worktree.path, worktreeTitle(worktree)));
		return { exitCode: EXIT_CODES.SUCCESS };
	}
	if (interactive) {
		deps.cdDirective.write(worktree.path);
	}
	return { exitCode: EXIT_CODES.SUCCESS, stdout: `${worktree.path}\n` };
};

/** Fuzzy-pick a worktree and print its path; interactively, open its session or hand the path to the shell. */
const pickCommand = async (args: string[], deps: Deps): Promise<CommandResult> => {
	const request = parsePickRequest(args);
	assertPickable(request, deps);
	const { items, worktrees } = await buildPickList(request, deps);
	const selected = await pickSelection({ deps, interactive: request.interactive, items });
	if (selected === undefined) {
		return { exitCode: EXIT_CODES.CANCELLED };
	}
	const worktree = requireSelectedWorktree(worktrees, selected);
	return openOrDirect({ deps, interactive: request.interactive, open: request.open, worktree });
};

export { pickCommand };
