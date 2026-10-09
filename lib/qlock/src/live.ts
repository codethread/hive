import { Database, SQLiteError } from "bun:sqlite";
import type { Dependencies, LockTarget, QueueStore } from "./run.ts";
import { EXIT, QlockError, emptyQueue, parseQueue } from "./queue.ts";
import type { QueueState } from "./queue.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Queue directory creation is a native filesystem boundary.
import { mkdir } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve caller-selected queue and database paths.
import { resolve } from "node:path";
import { z } from "zod";

const BUSY_TIMEOUT_MS = 5000;
const PROBE_SIGNAL = 0;
const NONEMPTY = 1;
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const rowSchema = z.strictObject({ snapshot: z.string() });

export function createLiveDependencies(): Dependencies {
	return {
		resolveLock,
		openQueue,
		now: Date.now,
		sleep: (milliseconds) => Bun.sleep(milliseconds),
		isAlive,
		execute: executeChild,
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

// --- Private functions ---

// eslint-disable-next-line max-statements -- Validate the destination and resolve repository identity in one command boundary.
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

async function executeChild(command: string[]): Promise<number> {
	const child = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	const forward = () => child.kill("SIGTERM");
	for (const signal of SIGNALS) {
		process.on(signal, forward);
	}
	try {
		return await child.exited;
	} finally {
		for (const signal of SIGNALS) {
			process.off(signal, forward);
		}
	}
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
