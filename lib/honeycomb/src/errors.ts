export const EXIT_CODES = {
	SUCCESS: 0,
	BLOCKED: 10,
	UNSAFE: 11,
	USAGE: 12,
	CANCELLED: 130,
	FAILURE: 1,
} as const;

/** Whether a failure is a recoverable refusal or the command could not run. */
export type FailureKind = "blocked" | "error";

/** Known facts about the failed operation, reported alongside its reason. */
export interface FailureContext {
	/** Requested or checked-out branch name. */
	branch?: string | undefined;
	/** Checkout selected or created by the operation. */
	worktree_path?: string | undefined;
	/** Explicitly selected pool path, when applicable. */
	slot_path?: string | undefined;
	/** Setup command exit status, when setup failed. */
	setup_exit_code?: number | undefined;
	/** Whether finish integrated the source before failing. */
	integrated?: boolean | undefined;
	/** Finish cleanup actions that completed before failing. */
	cleanup_actions?: string[] | undefined;
}

/** Base of every expected failure; the CLI boundary formats it for humans and machines. */
export class HoneycombError extends Error {
	/** Process status from the documented exit-code taxonomy. */
	exitCode: number;
	/** Recoverable refusal or failure to run. */
	readonly kind: FailureKind = "error";
	/** Machine-readable failure token; consumers branch on it, never on message text. */
	readonly reason: string = "failure";
	/** Facts gathered by the command before it failed. */
	context: FailureContext = {};
	constructor(message: string, exitCode: number = EXIT_CODES.FAILURE, options?: ErrorOptions) {
		super(message, options);
		this.exitCode = exitCode;
		this.name = new.target.name;
	}
}

/** A non-honeycomb throw, normalized so the boundary formats everything the same way. */
export class UnexpectedError extends HoneycombError {
	override readonly reason = "internal";
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), EXIT_CODES.FAILURE, { cause });
	}
}

export class UsageError extends HoneycombError {
	override readonly reason: string = "usage";
	constructor(message: string) {
		super(message, EXIT_CODES.USAGE);
	}
}

export class BlockedError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "blocked";
	constructor(message: string) {
		super(message, EXIT_CODES.BLOCKED);
	}
}

export class UnsafeOperationError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "unsafe";
	constructor(message: string) {
		super(message, EXIT_CODES.UNSAFE);
	}
}

export class ConfigError extends UsageError {
	override readonly reason = "config";
}
export class PickerCancelled extends HoneycombError {
	override readonly reason = "cancelled";
	constructor() {
		super("cancelled", EXIT_CODES.CANCELLED);
	}
}
export class DuplicateBranchError extends BlockedError {
	override readonly reason = "duplicate_branch";
}
export class DirtySlotError extends UnsafeOperationError {
	override readonly reason = "dirty_slot";
}
export class UnmergedBranchError extends UnsafeOperationError {
	override readonly reason = "unmerged_branch";
}
export class DirtyCanonicalError extends BlockedError {
	override readonly reason = "dirty_canonical";
}
export class DirtyWorktreeError extends BlockedError {
	override readonly reason = "dirty_worktree";
}
export class WrongCanonicalBranchError extends BlockedError {
	override readonly reason = "wrong_canonical_branch";
}
export class NonFastForwardCanonicalError extends BlockedError {
	override readonly reason = "non_ff_canonical";
}
export class TargetNotFreshError extends BlockedError {
	override readonly reason = "target_not_fresh";
}
export class FinishConflictError extends BlockedError {
	override readonly reason = "conflict";
}
export class PushRejectedError extends BlockedError {
	override readonly reason = "push_rejected";
}
export class ReservedPrefixError extends UsageError {
	override readonly reason = "reserved_prefix";
}
export class CanonicalRootError extends UnsafeOperationError {
	override readonly reason = "canonical_root";
}
export class PreRemoteCheckError extends BlockedError {
	override readonly reason = "pre_remote_check_failed";
	operation: string;
	source: string | null;
	stderr: string;
	constructor(operation: string, source: string | null, stderr: string) {
		super(
			stderr.trim() !== ""
				? `pre_remote_check failed before ${operation}${source ? ` (${source})` : ""}\n${stderr.trimEnd()}`
				: `pre_remote_check failed before ${operation}${source ? ` (${source})` : ""}`,
		);
		this.operation = operation;
		this.source = source;
		this.stderr = stderr;
	}
}
export class HookError extends HoneycombError {
	override readonly reason = "setup_failed";
	hookExitCode: number;
	slotPath: string;
	constructor(hookExitCode: number, slotPath: string) {
		super(`hook failed in ${slotPath} (${hookExitCode})`, EXIT_CODES.FAILURE);
		this.hookExitCode = hookExitCode;
		this.slotPath = slotPath;
		this.context = { worktree_path: slotPath, setup_exit_code: hookExitCode };
	}
}
export class TrunkDetectionError extends UsageError {
	override readonly reason = "trunk_detection_failed";
}

/** Normalize any thrown value into a honeycomb failure. */
export const toHoneycombError = (error: unknown): HoneycombError =>
	error instanceof HoneycombError ? error : new UnexpectedError(error);

/**
 * Attach what the command knew when it failed. Facts recorded where the error was
 * raised win over the command's broader context.
 */
export const withFailureContext = (error: unknown, context: FailureContext): HoneycombError => {
	const failure = toHoneycombError(error);
	const known = Object.fromEntries(
		Object.entries(context).filter(([, value]) => value !== undefined),
	);
	failure.context = { ...known, ...failure.context };
	return failure;
};
