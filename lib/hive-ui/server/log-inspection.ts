import type { ColonyInspection, RepositoryEndpoint } from "@hive/shared";
import { CommandError } from "@hive/beads";
import { colonyResponseSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Inspection artifact paths must be absolute server evidence.
import { isAbsolute } from "node:path";
import { z } from "zod";

export interface InspectionTarget {
	/** Explicit server state; absent preserves Colony CLI's public default. */
	state?: string | undefined;
	/** Explicit socket paired with explicit state at startup. */
	socket?: string | undefined;
}
interface InspectionDependencies {
	/** Typed subprocess seam; production composes Shared execute at startup. */
	execute: (argv: string[], cwd: string) => Promise<string>;
	/** Correlated UI diagnostics, without inspection output or log contents. */
	log: (sample: object) => Promise<void>;
}

/** Consume the existing CLI, never start/wake/register/reconcile or open Colony's database. */
export function createColonyInspector(
	{ execute, log }: InspectionDependencies,
	target: InspectionTarget,
) {
	// eslint-disable-next-line max-statements -- One CLI boundary validates and records each inspection outcome.
	return async (repository: RepositoryEndpoint): Promise<ColonyInspection> => {
		const argv = [
			"colony",
			"inspect",
			"--repo",
			repository.root,
			"--beads-db",
			repository.beadsDb,
			"--json",
		];
		if (target.state !== undefined) {
			argv.push("--state", target.state);
		}
		if (target.socket !== undefined) {
			argv.push("--socket", target.socket);
		}
		const start = performance.now();
		let outcome = "error";
		try {
			const value = await inspectionOutput(execute, argv, repository.root);
			const { ok: _ok, ...response } = z.looseObject({ ok: z.literal(true) }).parse(value);
			const inspection = colonyResponseSchema.parse(response);
			if (inspection.kind !== "inspection") {
				throw new Error("Colony did not return retained inspection evidence.");
			}
			for (const attempt of inspection.attempts) {
				if (!isAbsolute(attempt.paths.stdout) || !isAbsolute(attempt.paths.stderr)) {
					throw new Error("Inspection returned a non-absolute log path.");
				}
			}
			outcome = "ok";
			return inspection;
		} finally {
			await log({
				scope: "native",
				operation: "colony inspect",
				argv,
				outcome,
				ms: Math.round(performance.now() - start),
			});
		}
	};
}

// --- CLI failure evidence ---
async function inspectionOutput(
	execute: InspectionDependencies["execute"],
	argv: string[],
	cwd: string,
): Promise<unknown> {
	try {
		return JSON.parse(await execute(argv, cwd));
	} catch (error) {
		if (error instanceof CommandError) {
			const failure = z
				.object({ ok: z.literal(false), message: z.string() })
				.parse(JSON.parse(error.stdout));
			throw new Error(`Existing Colony inspection is unavailable: ${failure.message}`, {
				cause: error,
			});
		}
		throw error;
	}
}
