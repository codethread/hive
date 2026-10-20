import type { AttemptStatus, ColonyStatus, PolicyRevision, RepositoryEndpoint } from "@hive/shared";
import type { RequestEvent, RequestRecord } from "./request.ts";
import { launchReceiptSchema, workerReceiptSchema } from "./launch.ts";
import { requestRecordSchema, transitionRequest } from "./request.ts";
import { Database } from "bun:sqlite";
import type { LaunchReceipt } from "./launch.ts";
import type { PolicySnapshot } from "./policy.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Inventory must not observe or update foreign or unbound process artifacts.
 */
import { hostname } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- SQLite and receipt paths belong to daemon state.
import { join } from "node:path";
import { openHistory } from "./history.ts";
import { policyRevisionSchema } from "@hive/shared";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Read atomic worker receipt replacements without a cached BunFile size.
 */
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
const attemptRowsSchema = z.array(attemptRowSchema);
const trackerAuthorityRowsSchema = z.array(z.strictObject({ beadsDb: z.string() }));
const occupantsSchema = z.array(z.strictObject({ bucket: z.string(), kind: z.string() }));
const registrationRowSchema = z.strictObject({
	beadsDb: z.string(),
	intent: z.enum(["awake", "asleep"]),
	root: z.string(),
});
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
	database.exec(
		`PRAGMA journal_mode = WAL;
 CREATE TABLE IF NOT EXISTS repositories (
 root TEXT PRIMARY KEY, beads_db TEXT NOT NULL, intent TEXT NOT NULL ` +
			`CHECK(intent IN ('awake', 'asleep')));
 CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY, root TEXT NOT NULL, spawn_id TEXT NOT NULL, ` +
			`directory TEXT NOT NULL,
 token TEXT NOT NULL, snapshot TEXT NOT NULL, state TEXT NOT NULL, ` +
			`supervisor_pid INTEGER);
 CREATE TABLE IF NOT EXISTS requests (root TEXT NOT NULL, spawn_id ` +
			`TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(root, spawn_id));
 CREATE TABLE IF NOT EXISTS policy_revisions (id TEXT PRIMARY KEY, ` +
			`root TEXT NOT NULL, metadata TEXT NOT NULL, snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS active_policies (root TEXT PRIMARY KEY, ` +
			`revision_id TEXT NOT NULL REFERENCES policy_revisions(id));`,
	);
	database.exec(`CREATE INDEX IF NOT EXISTS attempts_by_request ON attempts(root, spawn_id);
 CREATE INDEX IF NOT EXISTS live_attempts_by_root ON attempts(root) WHERE state IN ('starting', 'running');
 CREATE INDEX IF NOT EXISTS attempts_by_tracker ON attempts(root, json_extract(snapshot, '$.beadsDb'));
 CREATE INDEX IF NOT EXISTS requests_by_tracker ON requests(root, json_extract(snapshot, '$.beadsDb'));`);
	const assertRepository = (repository: RepositoryEndpoint): void => {
		// Tracker indexes let the extrema prove agreement without reading every historical snapshot.
		const rows = trackerAuthorityRowsSchema.parse(
			database
				.query(
					`SELECT beads_db AS beadsDb FROM repositories WHERE root = ?1
 UNION SELECT beadsDb FROM (SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM attempts
 WHERE root = ?1 ORDER BY json_extract(snapshot, '$.beadsDb') LIMIT 1)
 UNION SELECT beadsDb FROM (SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM attempts
 WHERE root = ?1 ORDER BY json_extract(snapshot, '$.beadsDb') DESC LIMIT 1)
 UNION SELECT beadsDb FROM (SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM requests
 WHERE root = ?1 ORDER BY json_extract(snapshot, '$.beadsDb') LIMIT 1)
 UNION SELECT beadsDb FROM (SELECT json_extract(snapshot, '$.beadsDb') AS beadsDb FROM requests
 WHERE root = ?1 ORDER BY json_extract(snapshot, '$.beadsDb') DESC LIMIT 1)`,
				)
				.all(repository.root),
		);
		if (rows.some((row) => row.beadsDb !== repository.beadsDb)) {
			throw new Error(`Repository ${repository.root} already uses a different Beads database`);
		}
	};
	const attemptRows = (root: string, requestId?: string) => {
		let selection = "WHERE root = ?";
		const bindings = [root];
		if (requestId !== undefined) {
			selection += " AND spawn_id = ?";
			bindings.push(requestId);
		}
		return attemptRowsSchema.parse(
			database
				.query(
					"SELECT id, spawn_id AS spawnId, directory, token, snapshot, state " +
						`FROM attempts ${selection} ORDER BY rowid`,
				)
				.all(...bindings),
		);
	};
	const inventory = (root: string, requestIds?: Set<string>): Promise<AttemptInventory[]> => {
		const rows = attemptRows(root).filter(
			(row) => requestIds === undefined || requestIds.has(row.spawnId),
		);
		return Promise.all(
			/* eslint-disable-next-line max-statements --
			 * Refresh the owned receipt and process liveness together before updating inventory.
			 */
			rows.map(async (row) => {
				const launch = launchReceiptSchema.parse(JSON.parse(row.snapshot));
				if (launch.host !== hostname()) {
					return { id: row.id, receipt: launch, spawnId: row.spawnId, state: row.state };
				}
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
				"INSERT INTO requests (root, spawn_id, snapshot) VALUES (?, ?, ?) " +
					"ON CONFLICT(root, spawn_id) DO UPDATE SET snapshot = excluded.snapshot",
			)
			.run(root, record.id, JSON.stringify(record));
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
						"INSERT INTO active_policies (root, revision_id) VALUES (?, ?) ON " +
							"CONFLICT(root) DO UPDATE SET revision_id = excluded.revision_id",
					)
					.run(root, revision.id);
			})(),
		advanceRequest,
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
		close: () => database.close(),
		history: openHistory(database, state),
		inventory,
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
		request: (root: string, requestId: string): RequestRecord | undefined => {
			const row = database
				.query("SELECT snapshot FROM requests WHERE root = ? AND spawn_id = ?")
				.get(root, requestId);
			if (row === null) {
				return;
			}
			const { snapshot } = z.object({ snapshot: z.string() }).parse(row);
			return requestRecordSchema.parse(JSON.parse(snapshot));
		},
		retainedOccupants: (root: string): { bucket: string; kind: string }[] =>
			occupantsSchema.parse(
				database
					.query(
						"SELECT json_extract(snapshot, '$.bucket') AS bucket, " +
							"json_extract(snapshot, '$.recipe.kind') AS kind FROM attempts " +
							"WHERE root = ? AND state IN ('starting', 'running') " +
							"AND EXISTS (SELECT 1 FROM requests WHERE requests.root = attempts.root " +
							"AND requests.spawn_id = attempts.spawn_id AND json_extract(requests.snapshot, '$.host') = ?) " +
							"ORDER BY rowid",
					)
					.all(root, hostname()),
			),
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
						"INSERT INTO attempts (id, root, spawn_id, directory, token, snapshot, " +
							"state) VALUES (?, ?, ?, ?, ?, ?, 'starting')",
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
		/** Retained attempts in every state; optional request selection precedes receipt hydration. */
		retainedInventory: (root: string, requestId?: string): AttemptInventory[] =>
			attemptRows(root, requestId).map((row) => ({
				id: row.id,
				receipt: launchReceiptSchema.parse(JSON.parse(row.snapshot)),
				spawnId: row.spawnId,
				state: row.state,
			})),
		saveRequest,
		setActivity: (root: string, intent: ColonyStatus["intent"]) => {
			database.query("UPDATE repositories SET intent = ? WHERE root = ?").run(intent, root);
		},
		supervisor: (id: string, pid: number) => {
			database.query("UPDATE attempts SET supervisor_pid = ? WHERE id = ?").run(pid, id);
		},
	};
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
