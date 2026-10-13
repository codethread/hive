/* eslint-disable unicorn/no-null -- Retained fixtures preserve absent checkpoint and policy fields. */
import { afterAll, expect, test } from "bun:test";
import { diagnoseRequest, inspectRepository } from "./inspection.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Exercise the existing private SQLite boundary in disposable directories.
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import type { LaunchReceipt } from "./launch.ts";
import type { RequestRecord } from "./request.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve disposable store paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use disposable state without process artifacts.
import { tmpdir } from "node:os";

const EMPTY = 0;
const ONE = 1;
const TWO = 2;
const LARGE_HISTORY = 1000;
const OBSERVED = "2026-10-13T00:00:00Z";
const repository = { beadsDb: "/fixture/beads.db", root: "/fixture" };
const target = "target";
const fixtures = await Promise.all([EMPTY, LARGE_HISTORY].map((size) => createFixture(size)));
const historyCases = [
	{ index: EMPTY, historySize: EMPTY },
	{ index: ONE, historySize: LARGE_HISTORY },
];

afterAll(async () => {
	await Promise.all(
		fixtures.map(async ({ store, database, state }) => {
			database.close();
			store.close();
			await rm(state, { force: true, recursive: true });
		}),
	);
});

test.each(historyCases)(
	"diagnostic reads stay scoped with $historySize unrelated historical requests",
	// eslint-disable-next-line max-statements -- Measure the scoped boundary and verify retained contents together.
	({ index }) => {
		const { store } = fixtures[index]!;
		const reads = { attempts: EMPTY, checkpoints: EMPTY, reservations: EMPTY };
		const calls: string[] = [];
		const result = diagnoseRequest(repository, target, {
			...store,
			assertRepository: (endpoint) => {
				calls.push("authority");
				store.assertRepository(endpoint);
			},
			policyHistory: unexpectedRead,
			requests: unexpectedRead,
			retainedInventory: unexpectedRead,
			request: (root, id) => {
				calls.push("checkpoint");
				const record = store.request(root, id);
				if (record) {
					reads.checkpoints += ONE;
				}
				return record;
			},
			retainedAttempts: (root, id) => {
				calls.push("attempts");
				const rows = store.retainedAttempts(root, id);
				reads.attempts += rows.length;
				return rows;
			},
			retainedReservations: (root) => {
				calls.push("reservations");
				const rows = store.retainedReservations(root);
				reads.reservations += rows.length;
				return rows;
			},
		});
		expect(calls).toEqual(["authority", "checkpoint", "attempts", "reservations"]);
		expect(reads).toEqual({ attempts: TWO, checkpoints: ONE, reservations: TWO });
		expect(result.checkpoint?.id).toBe(target);
		expect(result.attempts.map(({ id, state }) => ({ id, state }))).toEqual([
			{ id: "target-failed", state: "failed" },
			{ id: "target-exited", state: "exited" },
		]);
		expect(result.reservations.map(({ id, state }) => ({ id, state }))).toEqual([
			{ id: "other-starting", state: "starting" },
			{ id: "other-running", state: "running" },
		]);
		expect(result).not.toHaveProperty("history");
		expect(diagnoseRequest({ ...repository, root: "/other" }, target, store)).toMatchObject({
			attempts: [],
			checkpoint: null,
			reservations: [],
		});
	},
);

test.each(historyCases)(
	"public inspect retains all history with $historySize historical requests",
	({ index, historySize }) => {
		const { store } = fixtures[index]!;
		const result = inspectRepository(repository, store);
		const liveAndTarget = 4;
		expect(result.attempts).toHaveLength(historySize + liveAndTarget);
		expect(result.requests).toHaveLength(historySize + TWO);
		expect(result.history).toHaveLength(historySize);
		expect(result.attempts.map(({ id }) => id)).toContain("target-exited");
		expect(result.requests.map(({ id }) => id)).toContain("other");
	},
);

test("checkpoint point reads return fresh writes and do not hydrate unrelated records", () => {
	const fixture = fixtures[EMPTY]!;
	const record = fixture.store.request(repository.root, target)!;
	const message = "Fresh reconciliation";
	fixture.store.saveRequest(repository.root, {
		...record,
		context: { ...record.context, message },
	});
	expect(fixture.store.request(repository.root, target)?.context.message).toBe(message);
	expect(fixture.store.request(repository.root, "missing")).toBeUndefined();
});

test.each([
	{ source: "registration", tracker: "/a.db" },
	{ source: "checkpoint", tracker: "/a.db" },
	{ source: "checkpoint", tracker: "/z.db" },
	{ source: "attempt", tracker: "/a.db" },
	{ source: "attempt", tracker: "/z.db" },
])(
	"$source authority rejects retained tracker $tracker",
	// eslint-disable-next-line max-statements -- Establish each independent retained authority and check rejection after membership removal.
	({ source, tracker }) => {
		const { database, store } = fixtures[EMPTY]!;
		const root = `/${source}${tracker}`;
		const selected = { ...repository, root };
		if (source === "registration") {
			store.register({ beadsDb: tracker, root });
		} else {
			store.register(selected);
			store.saveRequest(root, request("matching"));
			if (source === "checkpoint") {
				store.saveRequest(root, { ...request("conflict"), beadsDb: tracker });
			} else {
				insertAttempt(database, root, receipt(`matching-${tracker}`, "matching"), "exited");
				insertAttempt(
					database,
					root,
					{ ...receipt(`conflict-${tracker}`, "conflict"), beadsDb: tracker },
					"exited",
				);
			}
			store.remove(root);
		}
		expect(() => diagnoseRequest(selected, target, store)).toThrow(Error);
	},
);

test("unrelated malformed history is excluded from diagnostic hydration", () => {
	const { database, store } = fixtures[ONE]!;
	database
		.query("UPDATE requests SET snapshot = ? WHERE root = ? AND spawn_id = ?")
		.run(JSON.stringify({ beadsDb: repository.beadsDb }), repository.root, "history-0");
	database
		.query("UPDATE attempts SET snapshot = ? WHERE root = ? AND spawn_id = ?")
		.run(JSON.stringify({ beadsDb: repository.beadsDb }), repository.root, "history-0");
	database
		.query("UPDATE policy_revisions SET metadata = ? WHERE root = ?")
		.run("malformed", repository.root);
	expect(diagnoseRequest(repository, target, store).attempts).toHaveLength(TWO);
	expect(store.request(repository.root, target)?.id).toBe(target);
});

// --- Private functions ---
async function createFixture(historySize: number) {
	const state = await mkdtemp(join(tmpdir(), "colony-inspection-"));
	const store = openStore(state);
	const database = new Database(join(state, "colony.sqlite"));
	// eslint-disable-next-line max-statements -- Build one coherent SQLite history fixture, including target and other live reservations.
	database.transaction(() => {
		insertRequest(database, request(target));
		insertRequest(database, request("other"));
		insertAttempt(database, repository.root, receipt("target-failed", target), "failed");
		insertAttempt(database, repository.root, receipt("target-exited", target), "exited");
		insertAttempt(database, repository.root, receipt("other-starting", "other"), "starting");
		insertAttempt(database, repository.root, receipt("other-running", "other"), "running");
		for (let index = EMPTY; index < historySize; index += ONE) {
			const id = `history-${index}`;
			insertRequest(database, request(id));
			insertAttempt(database, repository.root, receipt(id, id), "exited");
			database.query("INSERT INTO policy_revisions VALUES (?, ?, ?, ?)").run(
				id,
				repository.root,
				JSON.stringify({
					actor: null,
					createdAt: OBSERVED,
					formulaName: null,
					id,
					source: "canonical",
				}),
				"{}",
			);
		}
	})();
	return { database, historySize, state, store };
}

function request(id: string): RequestRecord {
	return {
		beadsDb: repository.beadsDb,
		context: {
			attemptId: null,
			attempts: EMPTY,
			claims: [],
			identity: "worker",
			message: "",
			outcome: null,
			pendingClaim: null,
			retryAt: null,
			taskIds: [],
		},
		host: "fixture-host",
		id,
		state: "waiting",
	};
}

function receipt(id: string, spawnId: string): LaunchReceipt {
	return {
		attemptNumber: ONE,
		beadsDb: repository.beadsDb,
		bucket: repository.root,
		createdAt: OBSERVED,
		cwd: repository.root,
		directory: `/fixture/${id}`,
		formula: { argv: [], executable: "fixture", headless: [] },
		host: "fixture-host",
		id,
		identity: "worker",
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: {
			cwd: null,
			effort: "low",
			harness: "fixture",
			kind: "worker",
			model: "fixture",
			prompt: "",
			system_prompt: "",
		},
		spawnId,
		taskIds: [],
		token: "fixture-token",
	};
}

// eslint-disable-next-line max-params -- Fixture rows retain root, immutable receipt and independent checkpoint state.
function insertAttempt(
	database: Database,
	root: string,
	launch: LaunchReceipt,
	state: string,
): void {
	database
		.query(
			"INSERT INTO attempts (id, root, spawn_id, directory, token, snapshot, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			launch.id,
			root,
			launch.spawnId,
			launch.directory,
			launch.token,
			JSON.stringify(launch),
			state,
		);
}

function insertRequest(database: Database, record: RequestRecord): void {
	database
		.query("INSERT INTO requests VALUES (?, ?, ?)")
		.run(repository.root, record.id, JSON.stringify(record));
}

function unexpectedRead(): never {
	throw new Error("Diagnostic must not load unrelated history");
}
