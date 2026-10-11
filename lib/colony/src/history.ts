/* eslint-disable unicorn/no-null -- History explicitly distinguishes unknown evidence from observed facts. */
import { requestOutcomeSchema, requestStateSchema } from "@hive/shared";
import { CommandError } from "@hive/beads";
import { Database } from "bun:sqlite";
import type { RepositoryEndpoint } from "@hive/shared";
import type { RequestRecord } from "./request.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Offline history opens only the selected daemon database.
import { join } from "node:path";
import { z } from "zod";

const ZERO = 0;
const RETAINED_OPERATIONS = 1000;
const UNFINISHED_OPERATIONS = 100;
const DIAGNOSTIC_LENGTH = 2048;
const checkpointSchema = z.strictObject({
	attemptId: z.string().nullable(),
	attempts: z.number().int().nonnegative(),
	claims: z.array(z.string()),
	outcome: requestOutcomeSchema.nullable(),
	pendingClaim: z.string().nullable(),
	retryAt: z.number().nullable(),
	state: requestStateSchema,
});
const stepSchema = z.strictObject({ operation: z.string(), target: z.string() });
const failureSchema = z.strictObject({
	code: z.string().nullable(),
	exitCode: z.number().nullable(),
	message: z.string(),
	step: stepSchema,
});
const operationSchema = z.strictObject({
	after: checkpointSchema.nullable(),
	before: checkpointSchema.nullable(),
	completedEffects: z.array(stepSchema),
	evidence: z.array(z.string()),
	failure: failureSchema.nullable(),
	finishedAt: z.string().nullable(),
	operation: z.enum(["claim", "launch", "reconcile", "prepare", "dispatch"]),
	requestId: z.string().nullable(),
	startedAt: z.string(),
	status: z.enum(["unfinished", "completed", "failed"]),
	step: stepSchema,
});
const rowSchema = z.strictObject({ sequence: z.number(), snapshot: z.string() });
type OperationRecord = z.infer<typeof operationSchema>;
export interface HistoryFilter {
	/** Canonical repository and selected tracker; neither is refreshed by history. */
	repository: RepositoryEndpoint;
	/** Only operations for this spawn request, when supplied. */
	request?: string | undefined;
	/** Include recorded failures, including handled native conflicts. */
	failures: boolean;
}
export interface HistoryResult {
	/** CLI result discriminator. */
	kind: "events";
	/** Selected repository authority. */
	repository: RepositoryEndpoint;
	/** Maximum retained operations across the selected daemon. */
	retention: number;
	/** Separate cap for unfinished operations, so idle polling cannot evict completed evidence. */
	unfinishedRetention: number;
	/** Oldest first by durable start sequence; gaps are normal. */
	events: (OperationRecord & { sequence: number })[];
}
export interface OperationEvidence {
	/** Persist the next boundary before invoking its effects. */
	step: (operation: string, target: string) => void;
	/** Record only an effect whose boundary has returned successfully. */
	completed: (operation: string, target: string) => void;
	/** Reference retained artifacts without reading or copying their contents. */
	reference: (path: string) => void;
	/** Preserve a native failure even if lifecycle policy handles it. */
	failed: (error: unknown) => void;
}
interface OperationInput {
	/** Selected repository and tracker authority. */
	repository: RepositoryEndpoint;
	/** Spawn request, or null for a repository dispatch failure. */
	requestId: string | null;
	/** Bounded set of lifecycle operations owned by Colony. */
	operation: OperationRecord["operation"];
	/** Last durable checkpoint, projected without messages or recipes. */
	checkpoint?: () => RequestRecord | undefined;
}

/** Owned by the daemon's existing SQLite writer; never used by inspection. */
export function openHistory(database: Database, state: string) {
	database.exec(`CREATE TABLE IF NOT EXISTS operations (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, root TEXT NOT NULL, beads_db TEXT NOT NULL,
 request_id TEXT, snapshot TEXT NOT NULL);`);
	return {
		// eslint-disable-next-line max-statements -- One operation owns durable start, progress and completion around external effects.
		run: async <Result>(
			input: OperationInput,
			action: (evidence: OperationEvidence) => Promise<Result>,
		): Promise<Result> => {
			const { repository, requestId, operation, checkpoint } = input;
			const before = projectCheckpoint(checkpoint?.());
			const record: OperationRecord = {
				after: before,
				before,
				completedEffects: [],
				evidence: [join(state, "daemon.log")],
				failure: null,
				finishedAt: null,
				operation,
				requestId,
				startedAt: new Date().toISOString(),
				status: "unfinished",
				step: { operation, target: requestId ?? repository.root },
			};
			const lastInsertRowid = database.transaction(() => {
				const inserted = database
					.query(
						"INSERT INTO operations (root, beads_db, request_id, snapshot) VALUES (?, ?, ?, ?)",
					)
					.run(repository.root, repository.beadsDb, requestId, JSON.stringify(record));
				database
					.query(`DELETE FROM operations WHERE json_extract(snapshot, '$.status') = 'unfinished'
 AND sequence NOT IN (SELECT sequence FROM operations WHERE json_extract(snapshot, '$.status') = 'unfinished' ORDER BY sequence DESC LIMIT ?)`)
					.run(UNFINISHED_OPERATIONS);
				return inserted.lastInsertRowid;
			})();
			const save = () => {
				record.after = projectCheckpoint(checkpoint?.());
				database
					.query("UPDATE operations SET snapshot = ? WHERE sequence = ?")
					.run(JSON.stringify(record), lastInsertRowid);
			};
			const evidence: OperationEvidence = {
				completed: (name, target) => {
					record.completedEffects.push({ operation: name, target });
					save();
				},
				failed: (error) => {
					record.failure = operationFailure(error, record.step);
					save();
				},
				reference: (path) => {
					if (!record.evidence.includes(path)) {
						record.evidence.push(path);
						save();
					}
				},
				step: (name, target) => {
					record.step = { operation: name, target };
					save();
				},
			};
			try {
				const result = await action(evidence);
				record.status = "completed";
				return result;
			} catch (error) {
				record.status = "failed";
				evidence.failed(error);
				throw error;
			} finally {
				database.transaction(() => {
					record.finishedAt = new Date().toISOString();
					save();
					if (
						record.status === "completed" &&
						record.failure === null &&
						record.completedEffects.length === ZERO &&
						JSON.stringify(record.before) === JSON.stringify(record.after)
					) {
						database.query("DELETE FROM operations WHERE sequence = ?").run(lastInsertRowid);
					}
					database
						.query(
							`DELETE FROM operations WHERE json_extract(snapshot, '$.status') != 'unfinished'
 AND sequence NOT IN (SELECT sequence FROM operations WHERE json_extract(snapshot, '$.status') != 'unfinished' ORDER BY sequence DESC LIMIT ?)`,
						)
						.run(RETAINED_OPERATIONS);
				})();
			}
		},
	};
}

/** Offline inspection uses SELECT only: no migrations, inventory refresh, socket or tracker. */
export function readHistory(state: string, filter: HistoryFilter): HistoryResult {
	const database = new Database(join(state, "colony.sqlite"), { readonly: true });
	try {
		const rows = z.array(rowSchema).parse(
			database
				.query(
					`SELECT sequence, snapshot FROM operations WHERE root = ? AND beads_db = ?
 AND (? IS NULL OR request_id = ?) ORDER BY sequence`,
				)
				.all(
					filter.repository.root,
					filter.repository.beadsDb,
					filter.request ?? null,
					filter.request ?? null,
				),
		);
		const events = rows
			.map(({ sequence, snapshot }) =>
				Object.assign(operationSchema.parse(JSON.parse(snapshot)), { sequence }),
			)
			.filter(
				(record) => !filter.failures || record.failure !== null || record.status === "failed",
			);
		return {
			events,
			kind: "events",
			repository: filter.repository,
			retention: RETAINED_OPERATIONS,
			unfinishedRetention: UNFINISHED_OPERATIONS,
		};
	} finally {
		database.close();
	}
}

// --- Private functions ---
function projectCheckpoint(
	record: RequestRecord | undefined,
): z.infer<typeof checkpointSchema> | null {
	if (!record) {
		return null;
	}
	const { attemptId, attempts, claims, outcome, pendingClaim, retryAt } = record.context;
	return { attemptId, attempts, claims, outcome, pendingClaim, retryAt, state: record.state };
}
function operationFailure(
	error: unknown,
	step: z.infer<typeof stepSchema>,
): z.infer<typeof failureSchema> {
	if (error instanceof Error && error.cause !== undefined) {
		return operationFailure(error.cause, step);
	}
	if (error instanceof CommandError) {
		let message = "Native diagnostic unavailable; inspect retained source evidence";
		if (error.nativeError) {
			message = redactDiagnostic(error.nativeError.message);
		}
		return {
			code: error.nativeError?.code ?? null,
			exitCode: error.code,
			message,
			step,
		};
	}
	return {
		code: null,
		exitCode: null,
		message: "Operation failed; inspect retained source evidence",
		step,
	};
}
function redactDiagnostic(message: string): string {
	return message
		.replaceAll(/\b(?<scheme>Bearer\s+)\S+/giu, "$<scheme>[redacted]")
		.replaceAll(
			/\b(?<key>[\w-]*(?:password|token|secret|api[_-]?key|authorization))["']?(?<separator>\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/giu,
			"$<key>$<separator>[redacted]",
		)
		.replaceAll(/(?<scheme>https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$<scheme>[redacted]@")
		.slice(ZERO, DIAGNOSTIC_LENGTH);
}
