// eslint-disable-next-line import/no-nodejs-modules -- Watch the selected endpoint's containing directory.
import { basename, dirname, join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Directory watches survive atomic artifact replacement.
import { existsSync, statSync, watch } from "node:fs";

const ARTIFACTS = ["finish.json", "worker.json", "ownership.json"];
const filesystemIO: FilesystemHintIO = {
	exists: existsSync,
	identity: directoryIdentity,
	watch: watchDirectory,
};

export type ColonyHintEvent = { type: "HINT" } | { type: "HINT_FAILURE"; message: string };
export interface ColonyHints {
	/** Replace the shallow current-attempt subscriptions. */
	update: (attemptDirectories: string[]) => void;
	/** Stop all notifications; repeated disposal is harmless. */
	dispose: () => void;
}
export interface FilesystemHintIO {
	/** Check presence only, without reading artifact contents. */
	exists: (path: string) => boolean;
	/** Identify the watched directory, throwing if unavailable. */
	identity: (directory: string) => string;
	/** Attach synchronously and return synchronous cleanup. Callbacks run after attachment. */
	watch: (directory: string, callbacks: HintWatchCallbacks) => () => void;
}
export interface HintWatchCallbacks {
	/** Native change with its optional shallow filename. */
	changed: (event: string, filename: string | null) => void;
	/** Terminal native watcher failure. */
	failed: (error: Error) => void;
	/** Watch ended without requested disposal. */
	closed: () => void;
}
interface Subscription {
	/** Suppress callbacks after removal, including queued close notifications. */
	active: boolean;
	/** Close the underlying watch. */
	close: () => void;
}

/** Observe filesystem hints only; native reconciliation remains the authority. */
// eslint-disable-next-line max-statements -- One observer owns subscriptions and its terminal failure/disposal state.
export function createFilesystemHints(
	beadsDb: string,
	notify: (event: ColonyHintEvent) => void,
	io: FilesystemHintIO = filesystemIO,
): ColonyHints {
	const subscriptions = new Map<string, Subscription>();
	const databaseDirectory = dirname(beadsDb);
	const databaseName = basename(beadsDb);
	let disabled = false;
	const remove = (directory: string, subscription: Subscription) => {
		subscription.active = false;
		subscriptions.delete(directory);
		subscription.close();
	};
	const dispose = () => {
		disabled = true;
		for (const [directory, subscription] of subscriptions) {
			remove(directory, subscription);
		}
	};
	const fail = (error: unknown) => {
		if (disabled) {
			return;
		}
		dispose();
		notify({ type: "HINT_FAILURE", message: String(error) });
	};
	const attach = (directory: string, names: string[]) => {
		const identity = io.identity(directory);
		const subscription: Subscription = { active: true, close: () => {} };
		// eslint-disable-next-line unicorn/no-immediate-mutation -- Setup rollback may queue close before watch returns.
		subscription.close = io.watch(directory, {
			changed: (event, filename) => {
				if (disabled || !subscription.active) {
					return;
				}
				try {
					if (event === "rename" && io.identity(directory) !== identity) {
						throw new Error(`Hint directory replaced: ${directory}`);
					}
				} catch (error) {
					fail(error);
					return;
				}
				if (filename === null || names.includes(filename)) {
					notify({ type: "HINT" });
				}
			},
			failed: (error) => {
				if (subscription.active) {
					fail(error);
				}
			},
			closed: () => {
				if (subscription.active) {
					fail(new Error(`Hint watch closed unexpectedly: ${directory}`));
				}
			},
		});
		subscriptions.set(directory, subscription);
		if (io.identity(directory) !== identity) {
			throw new Error(`Hint directory replaced during attachment: ${directory}`);
		}
	};
	try {
		attach(databaseDirectory, [databaseName, `${databaseName}-wal`]);
	} catch (error) {
		fail(error);
	}
	return {
		dispose,
		// eslint-disable-next-line max-statements -- Replace subscriptions and latch the attach gap together.
		update(attemptDirectories) {
			if (disabled) {
				return;
			}
			const current = new Set(attemptDirectories);
			try {
				for (const [directory, subscription] of subscriptions) {
					if (directory !== databaseDirectory && !current.has(directory)) {
						remove(directory, subscription);
					}
				}
				for (const directory of current) {
					if (!subscriptions.has(directory)) {
						attach(directory, ARTIFACTS);
						// Presence after attachment catches publications missed during the subscription gap.
						if (ARTIFACTS.some((name) => io.exists(join(directory, name)))) {
							notify({ type: "HINT" });
						}
					}
					if (disabled) {
						return;
					}
				}
			} catch (error) {
				fail(error);
			}
		},
	};
}

// --- Private functions ---
function directoryIdentity(directory: string): string {
	// eslint-disable-next-line node/no-sync -- Subscription and invalidation checks are synchronous boundary I/O.
	const stat = statSync(directory);
	if (!stat.isDirectory()) {
		throw new Error(`Hint path is not a directory: ${directory}`);
	}
	return `${stat.dev}:${stat.ino}`;
}
// eslint-disable-next-line max-statements -- Both watches form one resource with setup rollback.
function watchDirectory(directory: string, callbacks: HintWatchCallbacks): () => void {
	const identity = directoryIdentity(directory);
	const watcher = watch(directory, { persistent: false, recursive: false }, callbacks.changed);
	watcher.on("error", callbacks.failed);
	watcher.on("close", callbacks.closed);
	try {
		// Some platforms report watched-directory removal only through its parent.
		const parent = watch(
			dirname(directory),
			{ persistent: false, recursive: false },
			(_event, filename) => {
				if (filename !== null && filename !== basename(directory)) {
					return;
				}
				try {
					if (directoryIdentity(directory) !== identity) {
						throw new Error(`Hint directory replaced: ${directory}`);
					}
				} catch (error) {
					let failure = new Error(String(error));
					if (error instanceof Error) {
						failure = error;
					}
					callbacks.failed(failure);
				}
			},
		);
		parent.on("error", callbacks.failed);
		parent.on("close", callbacks.closed);
		return () => {
			watcher.close();
			parent.close();
		};
	} catch (error) {
		watcher.close();
		throw error;
	}
}
