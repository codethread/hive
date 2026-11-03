/* eslint-disable max-classes-per-file -- Transport failures retain the common request/phase error contract. */
import type { ColonyRequest, ColonyResponse } from "@hive/shared";
import { colonyResponseSchema } from "@hive/shared";
import { match } from "ts-pattern";

const REQUEST_TIMEOUT_MS = 10_000;

export type DaemonResponse = Exclude<ColonyResponse, { kind: "error" }>;

export class DaemonRequestError extends Error {
	/** Daemon command whose request failed. */
	readonly request: ColonyRequest["kind"];
	/** Failed boundary: transport, response reading/matching, schema or daemon rejection. */
	readonly phase: "transport" | "response" | "decode" | "daemon";
	constructor(
		request: ColonyRequest["kind"],
		phase: "transport" | "response" | "decode" | "daemon",
		cause: unknown,
	) {
		super(`Daemon ${request} failed during ${phase}: ${String(cause)}`, { cause });
		this.name = "DaemonRequestError";
		this.request = request;
		this.phase = phase;
	}
}
export class DaemonUnavailableError extends DaemonRequestError {
	constructor(request: ColonyRequest["kind"], phase: "transport" | "response", cause: unknown) {
		super(request, phase, cause);
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
	signal: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS),
): Promise<DaemonResponse> {
	const response = await fetch("http://localhost/", {
		body: JSON.stringify(request),
		headers: { "content-type": "application/json", "x-colony-state": target.state },
		method: "POST",
		signal,
		unix: target.socket,
	}).catch((error: unknown) => {
		throw new DaemonUnavailableError(request.kind, "transport", error);
	});
	const body: unknown = await response.json().catch((error: unknown) => {
		throw new DaemonUnavailableError(request.kind, "response", error);
	});
	const result = parseResponse(body, request.kind);
	if (result.kind === "error") {
		throw new DaemonRequestError(request.kind, "daemon", result.message);
	}
	if (!response.ok || !expectedResponse(request).includes(result.kind)) {
		throw new DaemonRequestError(
			request.kind,
			"response",
			`Unexpected daemon response ${response.status}: ${result.kind}`,
		);
	}
	return result;
}

// --- Private functions ---
function parseResponse(body: unknown, request: ColonyRequest["kind"]): ColonyResponse {
	try {
		return colonyResponseSchema.parse(body);
	} catch (error) {
		throw new DaemonRequestError(request, "decode", error);
	}
}

function expectedResponse(request: ColonyRequest): string[] {
	return match(request)
		.with({ kind: "execution-clearance" }, () => ["execution-clearance"])
		.with({ kind: "inspect" }, () => ["inspection"])
		.with({ kind: "inspect-request" }, () => ["request-inspection"])
		.with({ kind: "config" }, () => ["config"])
		.with({ kind: "wake" }, () => ["awake"])
		.with({ kind: "add" }, () => ["registered"])
		.with({ kind: "sleep" }, () => ["slept"])
		.with({ kind: "remove" }, () => ["removed"])
		.with({ kind: "stop" }, () => ["stopped"])
		.with({ kind: "status" }, () => ["status"])
		.with({ kind: "recover" }, () => ["status", "recovering"])
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
