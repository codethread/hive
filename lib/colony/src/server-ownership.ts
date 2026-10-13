import {
	currentProcessFingerprint,
	observeProcess,
	processFingerprintSchema,
} from "./processes.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Ownership receipts and socket identity live in the selected state directory.
 */
import { lstat, readFile, rename, unlink } from "node:fs/promises";
import { Database } from "bun:sqlite";
// eslint-disable-next-line import/no-nodejs-modules -- Probe a Unix listener without sending application commands.
import { createConnection } from "node:net";
// eslint-disable-next-line import/no-nodejs-modules -- Private daemon ownership paths.
import { join } from "node:path";
import { z } from "zod";

const PROBE_TIMEOUT = 1000;
const ownerSchema = z.strictObject({
	device: z.number(),
	id: z.string(),
	inode: z.number(),
	process: processFingerprintSchema,
	socket: z.string(),
});
interface ServerLocation {
	/** Absolute socket chosen by the operator. */
	socket: string;
	/** Private state directory, already created by the daemon. */
	state: string;
}

/** Hold a kernel-released lock before touching runtime state or recovering an owned socket. */
// eslint-disable-next-line max-statements -- Keep lock acquisition, recovery and failure release adjacent.
export async function claimServer(location: ServerLocation) {
	const lock = new Database(join(location.state, "daemon-lock.sqlite"), { create: true });
	try {
		// A reserved writer excludes other daemons without blocking their initial schema reads.
		lock.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
	} catch (error) {
		lock.close();
		throw new Error(`Daemon state is already owned or cannot be locked: ${location.state}`, {
			cause: error,
		});
	}
	try {
		await recoverSocket(location);
		const id = crypto.randomUUID();
		const ownerProcess = await currentProcessFingerprint();
		return {
			close: () => lock.close(),
			id,
			/** Publish the bound inode before accepting commands. */
			recordSocket: async () => {
				const bound = await lstat(location.socket);
				if (!bound.isSocket()) {
					throw new Error(`Daemon endpoint is not a socket: ${location.socket}`);
				}
				const owner = {
					device: bound.dev,
					id,
					inode: bound.ino,
					process: ownerProcess,
					socket: location.socket,
				};
				const temporary = join(location.state, "daemon.json.tmp");
				await Bun.write(temporary, JSON.stringify(owner));
				await rename(temporary, join(location.state, "daemon.json"));
			},
		};
	} catch (error) {
		lock.close();
		throw error;
	}
}

// --- Private functions ---
// eslint-disable-next-line max-statements -- All proofs must precede removal of the exact known socket inode.
async function recoverSocket(location: ServerLocation): Promise<void> {
	const existing = await lstat(location.socket).catch((error: unknown) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	});
	if (!existing) {
		return;
	}
	if (!existing.isSocket()) {
		throw new Error(`Refusing to replace a non-socket endpoint: ${location.socket}`);
	}
	const source = await readFile(join(location.state, "daemon.json"), "utf8");
	const owner = ownerSchema.parse(JSON.parse(source));
	if (
		owner.socket !== location.socket ||
		owner.device !== existing.dev ||
		owner.inode !== existing.ino
	) {
		throw new Error(`Socket ownership does not match the selected endpoint: ${location.socket}`);
	}
	if ((await observeProcess(owner.process)) === "live") {
		throw new Error(`The recorded daemon still owns ${location.socket}`);
	}
	await assertDisconnected(location.socket);
	const current = await lstat(location.socket);
	if (!current.isSocket() || current.dev !== owner.device || current.ino !== owner.inode) {
		throw new Error(`Socket changed during recovery: ${location.socket}`);
	}
	await unlink(location.socket);
}

function assertDisconnected(path: string): Promise<void> {
	/* eslint-disable-next-line promise/avoid-new --
	 * Adapt a native Unix connection probe without sending application data.
	 */
	return new Promise((resolve, reject) => {
		const probe = createConnection(path);
		probe.setTimeout(PROBE_TIMEOUT);
		probe.once("connect", () => {
			probe.destroy();
			reject(new Error(`Socket has an active listener: ${path}`));
		});
		probe.once("timeout", () => {
			probe.destroy();
			reject(new Error(`Cannot prove the socket is disconnected: ${path}`));
		});
		probe.once("error", (error) => {
			probe.destroy();
			if ("code" in error && error.code === "ECONNREFUSED") {
				resolve();
			} else {
				reject(error);
			}
		});
	});
}
