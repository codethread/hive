/* eslint-disable import/no-nodejs-modules -- Native independent alert-state adapter. */
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { AlertStore } from "./alerts.ts";
import { createAlertStore } from "./alerts.ts";
import { lock } from "proper-lockfile";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_RETRIES = 40;
const LOCK_DELAY_MS = 25;
const LOCK_FACTOR = 1;

/** Compose a store rooted in user state, never the selected database or its checkout. */
export function createNativeAlertStore(stateHome: string): AlertStore {
	return createAlertStore({
		read: async (database) => {
			try {
				return await readFile(alertStatePath(stateHome, database), "utf8");
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") {
					return;
				}
				throw error;
			}
		},
		write: (database, contents) => writeReceipt(alertStatePath(stateHome, database), contents),
		withLock: async (database, action) => {
			const destination = alertStatePath(stateHome, database);
			await mkdir(dirname(destination), { recursive: true, mode: DIRECTORY_MODE });
			const release = await lock(destination, {
				realpath: false,
				retries: {
					factor: LOCK_FACTOR,
					minTimeout: LOCK_DELAY_MS,
					maxTimeout: LOCK_DELAY_MS,
					retries: LOCK_RETRIES,
				},
			});
			try {
				return await action();
			} finally {
				await release();
			}
		},
		id: randomUUID,
		now: () => new Date().toISOString(),
	});
}

/** XDG ignores unset, empty and relative state roots. */
export function alertStateHome(configured: string | undefined, home: string): string {
	if (configured && isAbsolute(configured)) {
		return configured;
	}
	return join(home, ".local/state");
}

/** The resolved endpoint path is the key; repository display names do not participate. */
export function alertStatePath(stateHome: string, database: string): string {
	const key = createHash("sha256").update(database).digest("hex");
	return join(stateHome, "beeswax/tracker-alerts", `${key}.json`);
}

/** Keep harness observations in user state under the selected endpoint, separate from tracker files. */
export function alertSessionReceiptPath(
	stateHome: string,
	database: string,
	session: { harness: string; id: string },
): string {
	const endpoint = createHash("sha256").update(database).digest("hex");
	const key = createHash("sha256").update(session.id).digest("hex");
	return join(
		stateHome,
		"beeswax/tracker-alerts",
		`${endpoint}.sessions`,
		`${session.harness}-${key}.json`,
	);
}

// --- Private functions ---

async function writeReceipt(destination: string, contents: string): Promise<void> {
	const temporary = `${destination}.${randomUUID()}.tmp`;
	const file = await open(temporary, "wx", FILE_MODE);
	try {
		await file.writeFile(`${contents}\n`, "utf8");
		await file.sync();
		await rename(temporary, destination);
		await syncDirectory(dirname(destination));
	} finally {
		await file.close();
		await rm(temporary, { force: true });
	}
}

async function syncDirectory(path: string): Promise<void> {
	const directory = await open(path, "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}
