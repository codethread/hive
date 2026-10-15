import { CommandError } from "@hive/beads";
import type { RepositoryEndpoint } from "./bees-io.ts";

const NOTIFY_TIMEOUT_MS = 10_000;
const SUCCESS = 0;
const defaultNotificationIO: BeadsConflictNotificationIO = {
	notify: sendBeadsConflictNotification,
	report: console.error,
};

export interface BeadsConflictContext extends RepositoryEndpoint {
	/** Machine where synchronization or Colony stopped. */
	host: string;
	/** Operation interrupted by the conflict. */
	operation: string;
}

export interface BeadsConflictNotificationIO {
	/** Deliver the alert through cc-notify or a test substitute. */
	notify: (body: string) => Promise<void>;
	/** Surface notification failures alongside the conflict. */
	report: (message: string) => void;
}

/** A conflict established by Git's unmerged index, never by matching command text. */
export class BeadsGitConflictError extends Error {
	constructor(paths: string, options?: ErrorOptions) {
		super(`BEADS CONFLICT: unresolved tracker merge: ${paths}`, options);
		this.name = "BeadsGitConflictError";
	}
}

export function isBeadsConflict(error: unknown): error is Error {
	if (error instanceof BeadsGitConflictError) {
		return true;
	}
	if (!(error instanceof CommandError)) {
		return error instanceof Error && isBeadsConflict(error.cause);
	}
	const diagnostic = error.nativeError;
	return (
		diagnostic?.code === "SYNC_CONFLICT" ||
		// Native br sync --merge reports unresolved three-way conflicts as this exact configuration diagnostic.
		(diagnostic?.code === "CONFIG_ERROR" &&
			diagnostic.message.startsWith("Configuration error: Merge conflicts detected:"))
	);
}

export function formatBeadsConflict(error: Error, context: BeadsConflictContext): string {
	return [
		`Beads conflict stopped ${context.operation}.`,
		`Host: ${context.host}`,
		`Repository: ${context.root}`,
		`Tracker: ${context.beadsDb}`,
		error.message,
		"Action: stop tracker work, resolve the tracker conflict, then run beeswax beads sync before resuming.",
	].join("\n");
}

/** Alert at the operation boundary; delivery failure must not replace the conflict. */
export async function notifyBeadsConflict(
	error: unknown,
	context: BeadsConflictContext,
	io: BeadsConflictNotificationIO = defaultNotificationIO,
): Promise<void> {
	if (!isBeadsConflict(error)) {
		return;
	}
	try {
		await io.notify(formatBeadsConflict(error, context));
	} catch (notificationError) {
		io.report(`Beads conflict notification failed: ${String(notificationError)}\n${error.message}`);
	}
}

export async function sendBeadsConflictNotification(body: string): Promise<void> {
	const child = Bun.spawn(["cc-notify", "Beads conflict"], {
		killSignal: "SIGKILL",
		stderr: "inherit",
		stdin: new Blob([`${body}\n`]),
		stdout: "inherit",
		timeout: NOTIFY_TIMEOUT_MS,
	});
	const code = await child.exited;
	if (code !== SUCCESS) {
		throw new Error(`cc-notify failed with exit ${code} (signal: ${child.signalCode})`);
	}
}
