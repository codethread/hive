// oxlint-disable max-classes-per-file -- The error taxonomy is one cohesive module: a tiny class per failure reason keeps instanceof checks, exit codes, and reasons together.

export const EXIT_CODES = {
	BLOCKED: 10,
	CANCELLED: 130,
	FAILURE: 1,
	SUCCESS: 0,
	UNSAFE: 11,
	USAGE: 12,
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
		// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
		this.name = new.target.name;
	}
}

/** A non-honeycomb throw, normalized so the boundary formats everything the same way. */
export class UnexpectedError extends HoneycombError {
	override readonly reason = "internal";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(cause: unknown) {
		super(errorMessage(cause), EXIT_CODES.FAILURE, { cause });
	}
}

export class UsageError extends HoneycombError {
	override readonly reason: string = "usage";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.USAGE);
	}
}

export class BlockedError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "blocked";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.BLOCKED);
	}
}

export class UnsafeOperationError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "unsafe";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.UNSAFE);
	}
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class ConfigError extends UsageError {
	override readonly reason = "config";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- Renaming the exported class would change its public name.
export class PickerCancelled extends HoneycombError {
	override readonly reason = "cancelled";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor() {
		super("cancelled", EXIT_CODES.CANCELLED);
	}
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class DuplicateBranchError extends BlockedError {
	override readonly reason = "duplicate_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class DirtySlotError extends UnsafeOperationError {
	override readonly reason = "dirty_slot";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class UnmergedBranchError extends UnsafeOperationError {
	override readonly reason = "unmerged_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class DirtyCanonicalError extends BlockedError {
	override readonly reason = "dirty_canonical";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class DirtyWorktreeError extends BlockedError {
	override readonly reason = "dirty_worktree";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class WrongCanonicalBranchError extends BlockedError {
	override readonly reason = "wrong_canonical_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class NonFastForwardCanonicalError extends BlockedError {
	override readonly reason = "non_ff_canonical";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class TargetNotFreshError extends BlockedError {
	override readonly reason = "target_not_fresh";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class FinishConflictError extends BlockedError {
	override readonly reason = "conflict";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class PushRejectedError extends BlockedError {
	override readonly reason = "push_rejected";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class ReservedPrefixError extends UsageError {
	override readonly reason = "reserved_prefix";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class CanonicalRootError extends UnsafeOperationError {
	override readonly reason = "canonical_root";
}

export class PreRemoteCheckError extends BlockedError {
	override readonly reason = "pre_remote_check_failed";
	/** Remote operation that failed its preflight check. */
	operation: string;
	/** Remote source involved in the operation, when known. */
	source: string | null;
	/** Diagnostic output from the failed preflight check. */
	stderr: string;
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(operation: string, source: string | null, stderr: string) {
		super(preRemoteMessage(operation, source, stderr));
		this.operation = operation;
		this.source = source;
		this.stderr = stderr;
	}
}

export class HookError extends HoneycombError {
	override readonly reason = "setup_failed";
	/** Exit status returned by the setup hook. */
	hookExitCode: number;
	/** Worktree path where the setup hook failed. */
	slotPath: string;
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(hookExitCode: number, slotPath: string) {
		super(`hook failed in ${slotPath} (${hookExitCode})`, EXIT_CODES.FAILURE);
		this.hookExitCode = hookExitCode;
		this.slotPath = slotPath;
		this.context = { setup_exit_code: hookExitCode, worktree_path: slotPath };
	}
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
export class TrunkDetectionError extends UsageError {
	override readonly reason = "trunk_detection_failed";
}

/** Normalize any thrown value into a honeycomb failure. */
export function toHoneycombError(error: unknown): HoneycombError {
	if (error instanceof HoneycombError) {
		return error;
	}
	return new UnexpectedError(error);
}

/**
 * Attach what the command knew when it failed. Facts recorded where the error was
 * raised win over the command's broader context.
 */
export function withFailureContext(error: unknown, context: FailureContext): HoneycombError {
	const failure = toHoneycombError(error);
	const known = Object.fromEntries(
		Object.entries(context).filter(([, value]) => value !== undefined),
	);
	failure.context = { ...known, ...failure.context };
	return failure;
}

// --- Private helpers ---

function errorMessage(cause: unknown): string {
	if (cause instanceof Error) {
		return cause.message;
	}
	return String(cause);
}

function formatSource(source: string | null): string {
	if (!source) {
		return "";
	}
	return ` (${source})`;
}

function preRemoteMessage(operation: string, source: string | null, stderr: string): string {
	const prefix = `pre_remote_check failed before ${operation}${formatSource(source)}`;
	if (!stderr.trim()) {
		return prefix;
	}
	return `${prefix}\n${stderr.trimEnd()}`;
}
