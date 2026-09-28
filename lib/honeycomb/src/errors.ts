export const EXIT_CODES = {
	SUCCESS: 0,
	BLOCKED: 10,
	UNSAFE: 11,
	USAGE: 12,
	CANCELLED: 130,
	FAILURE: 1,
} as const;

export class HoneycombError extends Error {
	exitCode: number;
	constructor(message: string, exitCode: number = EXIT_CODES.FAILURE) {
		super(message);
		this.exitCode = exitCode;
		this.name = new.target.name;
	}
}

export class UsageError extends HoneycombError {
	constructor(message: string) {
		super(message, EXIT_CODES.USAGE);
	}
}

export class BlockedError extends HoneycombError {
	constructor(message: string) {
		super(message, EXIT_CODES.BLOCKED);
	}
}

export class UnsafeOperationError extends HoneycombError {
	constructor(message: string) {
		super(message, EXIT_CODES.UNSAFE);
	}
}

export class ConfigError extends UsageError {}
export class PickerCancelled extends HoneycombError {
	constructor() {
		super("cancelled", EXIT_CODES.CANCELLED);
	}
}
export class DuplicateBranchError extends BlockedError {}
export class DirtySlotError extends UnsafeOperationError {}
export class UnmergedBranchError extends UnsafeOperationError {}
export class DirtyCanonicalError extends BlockedError {}
export class DirtyWorktreeError extends BlockedError {}
export class WrongCanonicalBranchError extends BlockedError {}
export class NonFastForwardCanonicalError extends BlockedError {}
export class TargetNotFreshError extends BlockedError {}
export class FinishConflictError extends BlockedError {}
export class PushRejectedError extends BlockedError {}
export class ReservedPrefixError extends UsageError {}
export class CanonicalRootError extends UnsafeOperationError {}
export class PreRemoteCheckError extends BlockedError {
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
	hookExitCode: number;
	slotPath: string;
	constructor(hookExitCode: number, slotPath: string) {
		super(`hook failed in ${slotPath} (${hookExitCode})`, EXIT_CODES.FAILURE);
		this.hookExitCode = hookExitCode;
		this.slotPath = slotPath;
	}
}
export class TrunkDetectionError extends UsageError {}
