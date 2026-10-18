import type { ColonyRequest, ColonyResponse } from "@hive/shared";
import { colonyResponseSchema } from "@hive/shared";
import { match } from "ts-pattern";

const REQUEST_TIMEOUT_MS = 10_000;

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

// --- Private functions ---
function expectedResponse(request: ColonyRequest): string {
	return match(request)
		.with({ kind: "inspect" }, () => "inspection")
		.with({ kind: "inspect-request" }, () => "request-inspection")
		.with({ kind: "config" }, () => "config")
		.with({ kind: "wake" }, () => "awake")
		.with({ kind: "add" }, () => "registered")
		.with({ kind: "sleep" }, () => "slept")
		.with({ kind: "remove" }, () => "removed")
		.with({ kind: "stop" }, () => "stopped")
		.with({ kind: "status" }, () => "status")
		.with({ kind: "recover" }, () => "status")
		.exhaustive();
}
export function connectionUnavailable(error: unknown): boolean {
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
