import { Database, SQLiteError } from "bun:sqlite";
import type { Dependencies, LockTarget, QueueStore } from "./run.ts";
import { EXIT, QlockError, emptyQueue, parseQueue } from "./queue.ts";
import { configPath, parseConfig } from "./config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve user configuration and conventional signal statuses.
import { constants, homedir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Read user configuration and create queue directories.
import { mkdir, readFile } from "node:fs/promises";
import type { ChildExecution } from "./process.ts";
import type { QueueState } from "./queue.ts";
import type { RuntimeLimit } from "./config.ts";
import { executeChild } from "./process.ts";
import { normalizeError } from "./run.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve caller-selected queue and database paths.
import { resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Own a Unix process group with foreground supervision.
import { spawn } from "node:child_process";
import { z } from "zod";

const BUSY_TIMEOUT_MS = 5000;
const PROBE_SIGNAL = 0;
const NONEMPTY = 1;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const GROUP_POLL_MS = 20;
const SIGNAL_EXIT_BASE = 128;
const CLEANUP_RETRY_MS = 1000;
const groupMemberSchema = z.tuple([
	z.coerce.number().int().nonnegative(),
	z.string().min(NONEMPTY),
]);
const rowSchema = z.strictObject({ snapshot: z.string() });

export function createLiveDependencies(): Dependencies {
	return {
		resolveLock,
		openQueue,
		now: Date.now,
		sleep: (milliseconds) => Bun.sleep(milliseconds),
		isAlive,
		loadRuntimeLimit: () => readRuntimeLimit(configPath(homedir(), process.env.XDG_CONFIG_HOME)),
		execute: (command, limit) =>
			executeChild(command, limit, {
				start: startChild,
				onInterrupt,
				schedule: (milliseconds, expire) => {
					const timer = setTimeout(expire, milliseconds);
					return () => clearTimeout(timer);
				},
			}),
		pid: process.pid,
		cwd: process.cwd(),
		stdout: (text) => {
			process.stdout.write(text);
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
	};
}

/** SQLite's write transaction serializes snapshots across processes and releases on process death. */
// eslint-disable-next-line max-statements -- Initialize and close the native connection within one ownership scope.
export async function openQueue(lock: string): Promise<QueueStore> {
	const directory = `${lock}.d`;
	await mkdir(directory, { recursive: true });
	const database = new Database(resolve(directory, "queue.sqlite"), { create: true });
	try {
		database.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
		database.run(
			"CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL)",
		);
		const load = database.query("SELECT snapshot FROM queue WHERE id = 1");
		const save = database.query(
			"INSERT INTO queue (id, snapshot) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot",
		);
		const update = database.transaction((transform: (state: QueueState) => QueueState) => {
			const row = load.get();
			let state = emptyQueue();
			if (row !== null) {
				state = parseQueue(JSON.parse(rowSchema.parse(row).snapshot));
			}
			const next = transform(state);
			save.run(JSON.stringify(next));
			return next;
		});
		return {
			update: (transform) => {
				try {
					return update.immediate(transform);
				} catch (error) {
					return failQueue(error, lock);
				}
			},
			close: () => database.close(),
		};
	} catch (error) {
		database.close();
		return failQueue(error, lock);
	}
}

/** Missing configuration is unlimited; unreadable or malformed configuration fails visibly. */
export async function readRuntimeLimit(path: string): Promise<RuntimeLimit> {
	let text = "";
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { kind: "unlimited" };
		}
		throw new QlockError("invalid_config", `Cannot read ${path}: ${String(error)}`, EXIT.usage);
	}
	try {
		return parseConfig(text);
	} catch (error) {
		throw new QlockError("invalid_config", `${path}: ${String(error)}`, EXIT.usage);
	}
}

// --- Private functions ---

// Validate the destination and resolve repository identity in one command boundary.
// eslint-disable-next-line max-statements
async function resolveLock(target: LockTarget): Promise<string> {
	if (target.kind === "path") {
		return resolve(target.path);
	}
	const valid = await capture(["git", "check-ref-format", target.ref]);
	if (valid.code !== EXIT.success) {
		throw new QlockError("usage", `Invalid merge target: ${target.ref}`, EXIT.usage);
	}
	const root = await capture(["honeycomb", "root"]);
	if (root.code !== EXIT.success) {
		throw new QlockError(
			"repository_lookup_failed",
			`honeycomb root failed: ${root.stderr.trim()}`,
		);
	}
	const canonical = z.string().trim().min(NONEMPTY).parse(root.stdout);
	const key = new Bun.CryptoHasher("sha256").update(`${canonical}\n${target.ref}\n`).digest("hex");
	return `/tmp/agent-merge-${key}.lock`;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, PROBE_SIGNAL);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") {
			return false;
		}
		throw error;
	}
}

function startChild(command: string[]): ChildExecution {
	const [file, ...args] = command;
	if (file === undefined) {
		throw new Error("Missing executable");
	}
	const child = spawn(file, args, { detached: true, stdio: "inherit" });
	const exited = Promise.withResolvers<number>();
	child.once("error", exited.reject);
	child.once("exit", (code, signal) => {
		let status = code ?? EXIT.failure;
		if (signal !== null) {
			status = SIGNAL_EXIT_BASE + constants.signals[signal];
		}
		exited.resolve(status);
	});
	return {
		exited: awaitChildGroupExit(exited.promise, child.pid),
		signal: (signal) => {
			if (child.pid !== undefined) {
				try {
					signalGroup(child.pid, signal);
				} catch (error) {
					process.stderr.write(
						`qlock: Cannot signal process group ${child.pid}; retaining ownership: ${String(error)}\n`,
					);
					throw error;
				}
			}
		},
	};
}

async function awaitChildGroupExit(
	exited: Promise<number>,
	pid: number | undefined,
): Promise<number> {
	const code = await exited;
	if (pid !== undefined) {
		await verifyGroupCleanup(pid);
	}
	return code;
}

/** An observation failure is never permission to admit the next command. */
// eslint-disable-next-line max-statements -- Preserve the first failure while retaining and verifying ownership.
async function verifyGroupCleanup(pid: number): Promise<void> {
	let failure: QlockError | undefined = undefined;
	for (;;) {
		try {
			// eslint-disable-next-line no-await-in-loop -- Recheck after an explicitly retained cleanup failure.
			await awaitGroupExit(pid);
			break;
		} catch (error) {
			if (failure === undefined) {
				failure = normalizeError(error);
				process.stderr.write(
					`qlock: Cannot verify process group ${pid}; retaining ownership and attempting SIGKILL: ${failure.message}\n`,
				);
			}
			try {
				signalGroup(pid, "SIGKILL");
			} catch (signalError) {
				process.stderr.write(
					`qlock: Group cleanup failed; ownership retained: ${String(signalError)}\n`,
				);
			}
			// eslint-disable-next-line no-await-in-loop -- Retain the live owner until cleanup can be established.
			await Bun.sleep(CLEANUP_RETRY_MS);
		}
	}
	if (failure !== undefined) {
		throw failure;
	}
}

function onInterrupt(forward: () => void): () => void {
	for (const signal of SIGNALS) {
		process.on(signal, forward);
	}
	return () => {
		for (const signal of SIGNALS) {
			process.off(signal, forward);
		}
	};
}

function signalGroup(pid: number, signal: NodeJS.Signals | number): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") {
			return false;
		}
		throw error;
	}
}

async function awaitGroupExit(pid: number): Promise<void> {
	// eslint-disable-next-line no-await-in-loop -- Retain queue ownership until no live group members remain.
	while (signalGroup(pid, PROBE_SIGNAL) && (await hasLiveGroupMembers(pid))) {
		// eslint-disable-next-line no-await-in-loop -- Yield only while waiting for foreground descendants to exit.
		await Bun.sleep(GROUP_POLL_MS);
	}
}

async function hasLiveGroupMembers(pid: number): Promise<boolean> {
	const result = await capture(["ps", "-axo", "pgid=,stat="]);
	if (result.code !== EXIT.success) {
		throw new Error(`Cannot inspect process group ${pid}: ${result.stderr}`);
	}
	const members = result.stdout
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => groupMemberSchema.parse(line.trim().split(/\s+/u)));
	return members.some(([group, state]) => group === pid && !state.startsWith("Z"));
}

async function capture(argv: string[]) {
	const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}

function failQueue(error: unknown, lock: string): never {
	if (error instanceof SQLiteError && error.code?.startsWith("SQLITE_BUSY")) {
		throw new QlockError(
			"queue_busy",
			"Queue storage stayed busy beyond the five-second transaction timeout",
			EXIT.failure,
			{ lock },
		);
	}
	throw error;
}
