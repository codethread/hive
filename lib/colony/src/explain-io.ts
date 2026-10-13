import type { AttemptDetails, RepositoryEndpoint } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve capacity buckets and owned process artifacts at the I/O boundary.
import { join, resolve } from "node:path";
import { launchBucket, launchReceiptSchema } from "./launch.ts";
import type { ExplanationIO } from "./explain.ts";
import type { ServerTarget } from "./client.ts";
import { observeExecution } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Canonicalize the captured cwd without creating it.
import { realpath } from "node:fs/promises";
import { requestServer } from "./client.ts";

/** Compose scoped daemon reads and independent fresh ownership observations for the CLI. */
export function explanationIO(repository: RepositoryEndpoint, target: ServerTarget): ExplanationIO {
	return {
		bucket: async (cwd) => launchBucket(await realpath(resolve(repository.root, cwd ?? "."))),
		diagnose: async (requestId) => {
			const response = await requestServer(target, { kind: "diagnose", repository, requestId });
			if (response.kind !== "request_diagnostic") {
				throw new Error("Expected request diagnostic response");
			}
			return response;
		},
		observe: (requestId, attempt) => observeAttempt(repository, requestId, attempt),
		source: `daemon diagnose ${target.socket}`,
	};
}

// --- Private functions ---
async function observeAttempt(
	repository: RepositoryEndpoint,
	requestId: string,
	attempt: AttemptDetails,
): Promise<"live" | "stopped"> {
	const receipt = launchReceiptSchema.parse(await Bun.file(attempt.paths.receipt).json());
	if (
		receipt.id !== attempt.id ||
		receipt.spawnId !== requestId ||
		receipt.beadsDb !== repository.beadsDb
	) {
		throw new Error("Receipt does not match inspected attempt authority");
	}
	if (
		!(await Bun.file(join(receipt.directory, "ownership.json")).exists()) &&
		!(await Bun.file(join(receipt.directory, "supervisor.json")).exists())
	) {
		throw new Error("No ownership or supervisor handoff evidence; process state unknown");
	}
	const observed = await observeExecution(receipt);
	return observed.kind;
}
