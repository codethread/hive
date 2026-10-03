// oxlint-disable max-classes-per-file -- The error taxonomy is one cohesive module: a tiny class per failure reason keeps instanceof checks, exit codes, and reasons together.

const EXIT_CODES = {
	BLOCKED: 10,
	CANCELLED: 130,
	FAILURE: 1,
	SUCCESS: 0,
	UNSAFE: 11,
	USAGE: 12,
} as const;

/** Whether a failure is a recoverable refusal or the command could not run. */
type FailureKind = "blocked" | "error";

/** Known facts about the failed operation, reported alongside its reason. */
interface FailureContext {
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
class HoneycombError extends Error {
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
class UnexpectedError extends HoneycombError {
	override readonly reason = "internal";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(cause: unknown) {
		super(errorMessage(cause), EXIT_CODES.FAILURE, { cause });
	}
}

class UsageError extends HoneycombError {
	override readonly reason: string = "usage";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.USAGE);
	}
}

class BlockedError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "blocked";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.BLOCKED);
	}
}

class UnsafeOperationError extends HoneycombError {
	override readonly kind = "blocked";
	override readonly reason: string = "unsafe";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(message: string) {
		super(message, EXIT_CODES.UNSAFE);
	}
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class ConfigError extends UsageError {
	override readonly reason = "config";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- Renaming the exported class would change its public name.
class PickerCancelled extends HoneycombError {
	override readonly reason = "cancelled";
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor() {
		super("cancelled", EXIT_CODES.CANCELLED);
	}
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class DuplicateBranchError extends BlockedError {
	override readonly reason = "duplicate_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class DirtySlotError extends UnsafeOperationError {
	override readonly reason = "dirty_slot";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class UnmergedBranchError extends UnsafeOperationError {
	override readonly reason = "unmerged_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class DirtyCanonicalError extends BlockedError {
	override readonly reason = "dirty_canonical";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class DirtyWorktreeError extends BlockedError {
	override readonly reason = "dirty_worktree";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class WrongCanonicalBranchError extends BlockedError {
	override readonly reason = "wrong_canonical_branch";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class NonFastForwardCanonicalError extends BlockedError {
	override readonly reason = "non_ff_canonical";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class TargetNotFreshError extends BlockedError {
	override readonly reason = "target_not_fresh";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class FinishConflictError extends BlockedError {
	override readonly reason = "conflict";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class PushRejectedError extends BlockedError {
	override readonly reason = "push_rejected";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class ReservedPrefixError extends UsageError {
	override readonly reason = "reserved_prefix";
}

// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
class CanonicalRootError extends UnsafeOperationError {
	override readonly reason = "canonical_root";
}

class PreRemoteCheckError extends BlockedError {
	override readonly reason = "pre_remote_check_failed";
	operation: string;
	source: string | null;
	stderr: string;
	// oxlint-disable-next-line unicorn/custom-error-definition -- HoneycombError derives the concrete name from new.target, including external subclasses.
	constructor(operation: string, source: string | null, stderr: string) {
		super(preRemoteMessage(operation, source, stderr));
		this.operation = operation;
		this.source = source;
		this.stderr = stderr;
	}
}

class HookError extends HoneycombError {
	override readonly reason = "setup_failed";
	hookExitCode: number;
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
class TrunkDetectionError extends UsageError {
	override readonly reason = "trunk_detection_failed";
}

const errorMessage = (cause: unknown): string => {
	if (cause instanceof Error) {
		return cause.message;
	}
	return String(cause);
};

const formatSource = (source: string | null): string => {
	if (!source) {
		return "";
	}
	return ` (${source})`;
};

const preRemoteMessage = (operation: string, source: string | null, stderr: string): string => {
	const prefix = `pre_remote_check failed before ${operation}${formatSource(source)}`;
	if (!stderr.trim()) {
		return prefix;
	}
	return `${prefix}\n${stderr.trimEnd()}`;
};

/** Normalize any thrown value into a honeycomb failure. */
const toHoneycombError = (error: unknown): HoneycombError => {
	if (error instanceof HoneycombError) {
		return error;
	}
	return new UnexpectedError(error);
};

/**
 * Attach what the command knew when it failed. Facts recorded where the error was
 * raised win over the command's broader context.
 */
const withFailureContext = (error: unknown, context: FailureContext): HoneycombError => {
	const failure = toHoneycombError(error);
	const known = Object.fromEntries(
		Object.entries(context).filter(([, value]) => value !== undefined),
	);
	failure.context = { ...known, ...failure.context };
	return failure;
};

export {
	BlockedError,
	CanonicalRootError,
	ConfigError,
	DirtyCanonicalError,
	DirtySlotError,
	DirtyWorktreeError,
	DuplicateBranchError,
	EXIT_CODES,
	FinishConflictError,
	HoneycombError,
	HookError,
	NonFastForwardCanonicalError,
	PickerCancelled,
	PreRemoteCheckError,
	PushRejectedError,
	ReservedPrefixError,
	TargetNotFreshError,
	toHoneycombError,
	TrunkDetectionError,
	UnmergedBranchError,
	UnexpectedError,
	UnsafeOperationError,
	UsageError,
	withFailureContext,
	WrongCanonicalBranchError,
	type FailureContext,
	type FailureKind,
};
