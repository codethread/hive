import { EXIT, QlockError } from "./queue.ts";
import type { RuntimeLimit } from "./config.ts";

export interface ChildExecution {
	/** Settles only after verified group exit, or a spawn failure that created no child. */
	exited: Promise<number>;
	/** Signal the complete owned group; an already-exited group is a no-op. */
	signal: (signal: NodeJS.Signals) => void;
}

export interface ExecutionDependencies {
	/** Start a foreground command in a fresh owned process group. */
	start: (command: string[]) => ChildExecution;
	/** Subscribe to INT, TERM and HUP; return an unsubscribe operation. */
	onInterrupt: (forward: () => void) => () => void;
	/** Schedule a runtime deadline; return a cancellation operation. */
	schedule: (milliseconds: number, expire: () => void) => () => void;
}

/** Keep the slot owned through deadline termination and complete group exit. */
// eslint-disable-next-line max-statements -- One ownership scope installs and cleans up supervision.
export async function executeChild(
	command: string[],
	limit: RuntimeLimit,
	deps: ExecutionDependencies,
): Promise<number> {
	const child = deps.start(command);
	let expired = false;
	let signalingFailure: unknown = undefined;
	const signal = (name: NodeJS.Signals) => {
		try {
			child.signal(name);
		} catch (error) {
			signalingFailure = error;
		}
	};
	let cancel = () => {};
	const unsubscribe = deps.onInterrupt(() => signal("SIGTERM"));
	try {
		if (limit.kind === "timeout") {
			cancel = deps.schedule(limit.milliseconds, () => {
				expired = true;
				signal("SIGKILL");
			});
		}
		const code = await child.exited;
		if (signalingFailure !== undefined) {
			throw signalingFailure;
		}
		if (expired && limit.kind === "timeout") {
			throw new QlockError(
				"execution_timed_out",
				`Command exceeded runtime timeout (${limit.milliseconds}ms); killed its process group`,
				EXIT.runtimeTimeout,
			);
		}
		return code;
	} finally {
		cancel();
		unsubscribe();
	}
}
