/* eslint-disable import/max-dependencies -- Compose existing runtime boundaries with the independent advisory assessment lifecycle. */
import type { AttemptStatus, ColonyStatus, PolicyRevision, RepositoryEndpoint } from "@hive/shared";
import type { RequestEvent, RequestRecord } from "./request.ts";
import { launchReceiptSchema, workerReceiptSchema } from "./launch.ts";
import { requestRecordSchema, transitionRequest } from "./request.ts";
import type { Assessment } from "./postrun.ts";
import { Database } from "bun:sqlite";
import type { DroneReview } from "./drone.ts";
import type { LaunchReceipt } from "./launch.ts";
import type { PolicySnapshot } from "./policy.ts";
import { assessmentSchema } from "./postrun.ts";
import { droneReviewSchema } from "./drone.ts";
// eslint-disable-next-line import/no-nodejs-modules -- SQLite and receipt paths belong to daemon state.
import { join } from "node:path";
import { openEventJournal } from "./events.ts";
import { openHistory } from "./history.ts";
import { policyRevisionSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Read atomic worker receipt replacements without a cached BunFile size.
import { readFile } from "node:fs/promises";
import { z } from "zod";

const PROBE_SIGNAL = 0;
const attemptRowSchema = z.strictObject({
	directory: z.string(),
	id: z.string(),
	snapshot: z.string(),
	spawnId: z.string(),
	state: z.enum(["starting", "running", "exited", "failed"]),
	token: z.string(),
});
const registrationRowSchema = z.strictObject({
	beadsDb: z.string(),
	intent: z.enum(["awake", "asleep"]),
	root: z.string(),
});
const eventAttemptSchema = z.array(z.strictObject({ id: z.string(), directory: z.string() }));

export interface AttemptInventory extends AttemptStatus {
	/** Immutable launch authority, recipe and execution bucket. */
	receipt: LaunchReceipt;
}
export interface Registration {
	/** Durable repository membership. */
	repository: RepositoryEndpoint;
	/** Activity restored when the daemon starts. */
	intent: ColonyStatus["intent"];
}

export type Store = ReturnType<typeof openStore>;

/** Concrete registry and immutable launch reservations; only the socket owner writes here. */
export function openStore(state: string) {
	const database = new Database(join(state, "colony.sqlite"), { create: true });
	database.exec(`PRAGMA journal_mode = WAL;
 CREATE TABLE IF NOT EXISTS repositories (
 root TEXT PRIMARY KEY, beads_db TEXT NOT NULL, intent TEXT NOT NULL CHECK(intent IN ('awake', 'asleep')));
 CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, root TEXT NOT NULL, spawn_id TEXT NOT NULL, directory TEXT NOT NULL,
 token TEXT NOT NULL, snapshot TEXT NOT NULL, state TEXT NOT NULL, supervisor_pid INTEGER);
 CREATE INDEX IF NOT EXISTS attempts_request ON attempts(root, spawn_id);
 CREATE TABLE IF NOT EXISTS requests (root TEXT NOT NULL, spawn_id TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(root, spawn_id));
 CREATE TABLE IF NOT EXISTS policy_revisions (id TEXT PRIMARY KEY, root TEXT NOT NULL, metadata TEXT NOT NULL, snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drone_reviews (id TEXT PRIMARY KEY, root TEXT NOT NULL, target_attempt_id TEXT NOT NULL, snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, root TEXT NOT NULL, beads_db TEXT NOT NULL, request_id TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(root, request_id));
 CREATE TABLE IF NOT EXISTS active_policies (root TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES policy_revisions(id));`);
	const events = openEventJournal(database);
	const assertRepository = (repository: RepositoryEndpoint): void => {
		const rows = z.array(z.strictObject({ beadsDb: z.string() })).parse(
			database
				.query(
					`SELECT beads_db AS beadsDb FROM repositories WHERE root = ?
 UNION SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM attempts WHERE root = ?
 UNION SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM requests WHERE root = ?`,
				)
				.all(repository.root, repository.root, repository.root),
		);
		if (rows.some((row) => row.beadsDb !== repository.beadsDb)) {
			throw new Error(`Repository ${repository.root} already uses a different Beads database`);
		}
	};
	const attemptRows = (root: string) =>
		z
			.array(attemptRowSchema)
			.parse(
				database
					.query(
						"SELECT id, spawn_id AS spawnId, directory, token, snapshot, state FROM attempts WHERE root = ? ORDER BY rowid",
					)
					.all(root),
			);
	const inventory = (root: string): Promise<AttemptInventory[]> => {
		const rows = attemptRows(root);
		return Promise.all(
			// eslint-disable-next-line max-statements -- Refresh the owned receipt and process liveness together before updating inventory.
			rows.map(async (row) => {
				const launch = launchReceiptSchema.parse(JSON.parse(row.snapshot));
				const file = Bun.file(join(row.directory, "worker.json"));
				if (await file.exists()) {
					const workerText = await readFile(join(row.directory, "worker.json"), "utf8");
					const receipt = workerReceiptSchema.parse(JSON.parse(workerText));
					if (receipt.token !== row.token) {
						throw new Error(`Attempt ${row.id} has a mismatched worker token`);
					}
					let observed = receipt.kind;
					if (receipt.kind === "running" && !isAlive(receipt.harnessPid)) {
						observed = "failed";
					}
					database.query("UPDATE attempts SET state = ? WHERE id = ?").run(observed, row.id);
					return { id: row.id, receipt: launch, spawnId: row.spawnId, state: observed };
				}
				return { id: row.id, receipt: launch, spawnId: row.spawnId, state: row.state };
			}),
		);
	};
	const saveRequest = (root: string, record: RequestRecord): void => {
		database
			.query(
				"INSERT INTO requests (root, spawn_id, snapshot) VALUES (?, ?, ?) ON CONFLICT(root, spawn_id) DO UPDATE SET snapshot = excluded.snapshot",
			)
			.run(root, record.id, JSON.stringify(record));
	};
	const saveAssessment = (root: string, assessment: Assessment): void => {
		database
			.query(
				"INSERT INTO assessments (id, root, beads_db, request_id, snapshot) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot",
			)
			.run(
				assessment.id,
				root,
				assessment.beadsDb,
				assessment.requestId,
				JSON.stringify(assessment),
			);
	};
	const advanceRequest = (
		root: string,
		record: RequestRecord,
		event: RequestEvent,
	): RequestRecord => {
		const next = transitionRequest(record, event);
		saveRequest(root, next);
		return next;
	};
	return {
		activatePolicy: (root: string, revision: PolicyRevision, snapshot: PolicySnapshot): void =>
			database.transaction(() => {
				database
					.query("INSERT INTO policy_revisions (id, root, metadata, snapshot) VALUES (?, ?, ?, ?)")
					.run(revision.id, root, JSON.stringify(revision), JSON.stringify(snapshot));
				database
					.query(
						"INSERT INTO active_policies (root, revision_id) VALUES (?, ?) ON CONFLICT(root) DO UPDATE SET revision_id = excluded.revision_id",
					)
					.run(root, revision.id);
			})(),
		advanceRequest,
		assessments: (root: string): Assessment[] =>
			z
				.array(z.object({ snapshot: z.string() }))
				.parse(
					database
						.query("SELECT snapshot FROM assessments WHERE root = ? ORDER BY rowid")
						.all(root),
				)
				.map(({ snapshot }) => assessmentSchema.parse(JSON.parse(snapshot))),
		saveAssessment,
		settleRequest: (
			root: string,
			record: RequestRecord,
			assessment: Assessment | undefined,
		): void => {
			database.transaction(() => {
				if (assessment) {
					saveAssessment(root, assessment);
				}
				saveRequest(root, record);
				if (record.state === "terminal") {
					events.append({
						type: "request.settled",
						repository: { root, beadsDb: record.beadsDb },
						recordedAt: new Date().toISOString(),
						request: {
							id: record.id,
							identity: record.context.identity,
							outcome: record.context.outcome!,
							taskIds: record.context.taskIds,
							attempts: eventAttemptSchema
								.parse(
									database
										.query(
											"SELECT id, directory FROM attempts WHERE root = ? AND spawn_id = ? ORDER BY rowid",
										)
										.all(root, record.id),
								)
								.map(({ id, directory }) => ({
									id,
									receiptPath: join(directory, "receipt.json"),
									stdoutPath: join(directory, "stdout.log"),
								})),
						},
					});
				}
			})();
			events.notify();
		},
		assertRepository,
		attempts: async (root: string): Promise<AttemptStatus[]> => {
			const entries = await inventory(root);
			return entries.map(({ id, spawnId, state: observed }) => ({ id, spawnId, state: observed }));
		},
		clearPolicies: () => {
			database.query("DELETE FROM active_policies").run();
		},
		clearPolicy: (root: string) => {
			database.query("DELETE FROM active_policies WHERE root = ?").run(root);
		},
		close: () => {
			events.close();
			database.close();
		},
		events,
		history: openHistory(database, state),
		inventory,
		latestDroneReview: (root: string, targetAttemptId: string): DroneReview | undefined => {
			const row = database
				.query(
					"SELECT snapshot FROM drone_reviews WHERE root = ? AND target_attempt_id = ? ORDER BY rowid DESC LIMIT 1",
				)
				.get(root, targetAttemptId);
			if (row === null) {
				return;
			}
			const { snapshot } = z.object({ snapshot: z.string() }).parse(row);
			return droneReviewSchema.parse(JSON.parse(snapshot));
		},
		policyHistory: (root: string): PolicyRevision[] =>
			z
				.array(z.object({ metadata: z.string() }))
				.parse(
					database
						.query("SELECT metadata FROM policy_revisions WHERE root = ? ORDER BY rowid")
						.all(root),
				)
				.map(({ metadata }) => policyRevisionSchema.parse(JSON.parse(metadata))),
		register: (repository: RepositoryEndpoint) => {
			assertRepository(repository);
			database
				.query(
					"INSERT OR IGNORE INTO repositories (root, beads_db, intent) VALUES (?, ?, 'asleep')",
				)
				.run(repository.root, repository.beadsDb);
		},
		registrations: (): Registration[] =>
			z
				.array(registrationRowSchema)
				.parse(
					database
						.query("SELECT root, beads_db AS beadsDb, intent FROM repositories ORDER BY rowid")
						.all(),
				)
				.map(({ root, beadsDb, intent }) => ({ intent, repository: { beadsDb, root } })),
		remove: (root: string) => {
			database.query("DELETE FROM repositories WHERE root = ?").run(root);
		},
		requests: (root: string): RequestRecord[] =>
			z
				.array(z.object({ snapshot: z.string() }))
				.parse(
					database.query("SELECT snapshot FROM requests WHERE root = ? ORDER BY rowid").all(root),
				)
				.map(({ snapshot }) => requestRecordSchema.parse(JSON.parse(snapshot))),
		reserve: (root: string, receipt: LaunchReceipt, record: RequestRecord): RequestRecord =>
			database.transaction(() => {
				database
					.query(
						"INSERT INTO attempts (id, root, spawn_id, directory, token, snapshot, state) VALUES (?, ?, ?, ?, ?, ?, 'starting')",
					)
					.run(
						receipt.id,
						root,
						receipt.spawnId,
						receipt.directory,
						receipt.token,
						JSON.stringify(receipt),
					);
				return advanceRequest(root, record, { id: receipt.id, type: "START" });
			})(),
		/** Retained reservations only: inspection must not refresh or persist process state. */
		retainedInventory: (root: string): AttemptInventory[] =>
			attemptRows(root).map((row) => ({
				id: row.id,
				receipt: launchReceiptSchema.parse(JSON.parse(row.snapshot)),
				spawnId: row.spawnId,
				state: row.state,
			})),
		saveDroneReview: (root: string, review: DroneReview): void => {
			database
				.query(
					"INSERT INTO drone_reviews (id, root, target_attempt_id, snapshot) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot",
				)
				.run(review.id, root, review.targetAttemptId, JSON.stringify(review));
		},
		saveRequest,
		setActivity: (root: string, intent: ColonyStatus["intent"]) => {
			database.query("UPDATE repositories SET intent = ? WHERE root = ?").run(intent, root);
		},
		supervisor: (id: string, pid: number) => {
			database.query("UPDATE attempts SET supervisor_pid = ? WHERE id = ?").run(pid, id);
		},
	};
}

/** Bee reads the durable current target and review without taking daemon write authority. */
export function readDroneAuthority(
	state: string,
	reviewId: string,
): { review: DroneReview; request: RequestRecord } {
	const database = new Database(join(state, "colony.sqlite"), { readonly: true });
	try {
		const row = z
			.object({ root: z.string(), snapshot: z.string() })
			.parse(database.query("SELECT root, snapshot FROM drone_reviews WHERE id = ?").get(reviewId));
		const review = droneReviewSchema.parse(JSON.parse(row.snapshot));
		const requestRow = z
			.object({ snapshot: z.string() })
			.parse(
				database
					.query("SELECT snapshot FROM requests WHERE root = ? AND spawn_id = ?")
					.get(row.root, review.spawnId),
			);
		return { request: requestRecordSchema.parse(JSON.parse(requestRow.snapshot)), review };
	} finally {
		database.close();
	}
}

/** Read immutable post-run authority without acquiring daemon write ownership. */
export function readAssessmentAuthority(state: string, id: string): Assessment {
	const database = new Database(join(state, "colony.sqlite"), { readonly: true });
	try {
		const row = z
			.object({ snapshot: z.string() })
			.parse(database.query("SELECT snapshot FROM assessments WHERE id = ?").get(id));
		return assessmentSchema.parse(JSON.parse(row.snapshot));
	} finally {
		database.close();
	}
}

// --- Private functions ---
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
