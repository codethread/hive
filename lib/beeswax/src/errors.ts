export const EXIT = { success: 0, failure: 1, usage: 2, cancelled: 130 } as const;

/** Preserve an Error diagnostic while still describing non-Error boundary throws. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

interface FailureOptions {
	/** Facts needed to inspect an incomplete operation. */
	context?: Record<string, unknown>;
	/** Native or CLI process status. */
	exitCode?: number;
}

/** A failure carrying the identifiers needed for the caller's next decision. */
export class BeeswaxError extends Error {
	/** Machine-readable cause. */
	readonly reason: string;
	/** Process status preserved by the CLI. */
	readonly exitCode: number;
	/** Facts needed to inspect partial work. */
	readonly context: Record<string, unknown>;
	constructor(reason: string, message: string, options: FailureOptions = {}) {
		super(message);
		this.name = "BeeswaxError";
		this.reason = reason;
		this.context = options.context ?? {};
		this.exitCode = options.exitCode ?? EXIT.failure;
	}
}
