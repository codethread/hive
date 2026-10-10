import type { ColonyRequest, ColonyResponse } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Daemon log and socket boundary.
import { mkdir, open } from "node:fs/promises";
import { colonyResponseSchema } from "@hive/shared";
import { entryCommand } from "./executables.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Daemon log path.
import { join } from "node:path";
import { match } from "ts-pattern";
// eslint-disable-next-line import/no-nodejs-modules -- Detached daemon process boundary.
import { spawn } from "node:child_process";

const REQUEST_TIMEOUT_MS = 10_000;
const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

export type DaemonResponse = Exclude<ColonyResponse, { kind: "error" }>;

export class DaemonUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DaemonUnavailableError";
	}
}

export interface ServerTarget {
	/** Absolute socket path selected by the caller. */
	socket: string;
	/** Absolute state directory selected by the caller. */
	state: string;
	/** Absolute executable entry resolved by the CLI. */
	runtimeEntry: string;
}

export async function requestServer(
	target: ServerTarget,
	request: ColonyRequest,
): Promise<DaemonResponse> {
	const response = await fetch("http://localhost/", {
		body: JSON.stringify(request),
		headers: { "content-type": "application/json", "x-colony-state": target.state },
		method: "POST",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		unix: target.socket,
	}).catch((error: unknown) => {
		throw new DaemonUnavailableError(`Cannot reach daemon at ${target.socket}: ${String(error)}`, {
			cause: error,
		});
	});
	const result = colonyResponseSchema.parse(await response.json());
	if (result.kind === "error") {
		throw new Error(result.message);
	}
	if (!response.ok || result.kind !== expectedResponse(request)) {
		throw new Error(`Unexpected daemon response ${response.status}: ${result.kind}`);
	}
	return result;
}

export async function requestLazyServer(
	target: ServerTarget,
	request: Extract<ColonyRequest, { kind: "wake" | "add" }>,
): Promise<DaemonResponse> {
	try {
		await requestServer(target, { kind: "status" });
	} catch (error) {
		if (!connectionUnavailable(error)) {
			throw error;
		}
		await startServer(target);
	}
	return requestServer(target, request);
}

// --- Private functions ---
function expectedResponse(request: ColonyRequest): string {
	return match(request)
		.with({ kind: "inspect" }, () => "inspection")
		.with({ kind: "config" }, () => "config")
		.with({ kind: "wake" }, () => "awake")
		.with({ kind: "add" }, () => "registered")
		.with({ kind: "sleep" }, () => "slept")
		.with({ kind: "remove" }, () => "removed")
		.with({ kind: "stop" }, () => "stopped")
		.with({ kind: "status" }, () => "status")
		.exhaustive();
}
function connectionUnavailable(error: unknown): boolean {
	let cause: unknown = undefined;
	if (error instanceof Error) {
		({ cause } = error);
	}
	return (
		cause instanceof Error &&
		"code" in cause &&
		(cause.code === "ENOENT" ||
			cause.code === "ECONNREFUSED" ||
			cause.code === "FailedToOpenSocket")
	);
}
// eslint-disable-next-line max-statements -- Spawn and readiness form one bounded startup operation.
async function startServer(target: ServerTarget): Promise<void> {
	await mkdir(target.state, { recursive: true });
	const logPath = join(target.state, "daemon.log");
	const log = await open(logPath, "a");
	const [executable, ...prefix] = entryCommand(target.runtimeEntry);
	const child = spawn(
		executable,
		[...prefix, "serve", "--socket", target.socket, "--state", target.state],
		{ detached: true, stdio: ["ignore", log.fd, log.fd] },
	);
	let spawnError: Error | undefined = undefined;
	child.on("error", (error) => {
		spawnError = error;
	});
	child.unref();
	await log.close();
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (spawnError) {
			throw spawnError;
		}
		try {
			// eslint-disable-next-line no-await-in-loop -- Readiness probes must be sequential.
			await requestServer(target, { kind: "status" });
			return;
		} catch (error) {
			if (!connectionUnavailable(error)) {
				throw error;
			}
		}
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`Daemon exited before readiness; inspect ${logPath}`);
		}
		// eslint-disable-next-line no-await-in-loop -- Bounded readiness polling.
		await Bun.sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`Daemon did not become ready at ${target.socket}; inspect ${logPath}`);
}
