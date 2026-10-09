#!/usr/bin/env bun
/* eslint-disable max-dependencies -- Foreground watcher composes status, notification and checkpoint IO. */
import { DaemonUnavailableError, requestServer } from "../src/client.ts";
import { WATCHDOG_POLL_MS, pollWatchdog, watchdogCheckpointSchema } from "../src/watchdog.ts";
import type { WatchdogCheckpoint, WatchdogObservation } from "../src/watchdog.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Atomic watcher checkpoint boundary.
import { mkdir, rename } from "node:fs/promises";
import { Command } from "commander";
import type { ServerSelection } from "../src/server-target.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Decode executable URL paths.
import { fileURLToPath } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Watcher checkpoint location.
import { join } from "node:path";
import { resolveServerTarget } from "../src/server-target.ts";

const NOTIFY_TIMEOUT_MS = 10_000;
const SUCCESS = 0;
const program = new Command()
	.name("colony-watchdog")
	.description("Observe Colony every 30s and notify via cc-notify; never wake or repair it")
	.option("--state <directory>", "Colony state directory (same default as colony)")
	.option("--socket <path>", "Colony socket; requires --state")
	.parse();
const target = resolveServerTarget(
	program.opts<ServerSelection>(),
	fileURLToPath(new URL("runtime.ts", import.meta.url)),
);
const directory = join(target.state, "watchdog");
const socketKey = new Bun.CryptoHasher("sha256").update(target.socket).digest("hex");
const checkpointPath = join(directory, `${socketKey}.json`);
const checkpointFile = Bun.file(checkpointPath);
// eslint-disable-next-line unicorn/no-null -- JSON checkpoint uses explicit absence.
let checkpoint: WatchdogCheckpoint = { failures: [], outage: null };
if (await checkpointFile.exists()) {
	checkpoint = watchdogCheckpointSchema.parse(await checkpointFile.json());
}

for (;;) {
	// eslint-disable-next-line no-await-in-loop -- Polls and delivered-state commits must be sequential.
	checkpoint = await pollWatchdog(checkpoint, { notify, now: Date.now, observe, save });
	// eslint-disable-next-line no-await-in-loop -- Independent foreground observer cadence.
	await Bun.sleep(WATCHDOG_POLL_MS);
}

async function observe(): Promise<WatchdogObservation> {
	try {
		const status = await requestServer(target, { kind: "status" });
		if (status.kind !== "status") {
			throw new Error(`Unexpected watchdog response: ${status.kind}`);
		}
		return { colonies: status.colonies, kind: "reachable" };
	} catch (error) {
		if (!(error instanceof DaemonUnavailableError)) {
			throw error;
		}
		return { kind: "unavailable" };
	}
}

async function notify(body: string): Promise<void> {
	const child = Bun.spawn(["cc-notify", "Colony health"], {
		killSignal: "SIGKILL",
		stderr: "inherit",
		stdin: new Blob([`${body}\n\nState: ${target.state}\nSocket: ${target.socket}\n`]),
		stdout: "inherit",
		timeout: NOTIFY_TIMEOUT_MS,
	});
	const code = await child.exited;
	if (code !== SUCCESS) {
		throw new Error(`cc-notify failed with exit ${code} (signal: ${child.signalCode})`);
	}
}

async function save(next: WatchdogCheckpoint): Promise<void> {
	await mkdir(directory, { recursive: true });
	const temporary = `${checkpointPath}.tmp`;
	await Bun.write(temporary, `${JSON.stringify(next)}\n`);
	await rename(temporary, checkpointPath);
}
