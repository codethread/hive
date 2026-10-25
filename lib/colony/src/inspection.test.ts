/* eslint-disable import/max-dependencies -- Compose the real SQLite, transport, native memory and CLI boundaries. */
/* eslint-disable unicorn/no-null -- Retained fixtures preserve absent checkpoint and policy fields. */
import { afterAll, expect, test } from "bun:test";
import {
	createSpawn,
	createTask,
	createWorkflowControl,
	memoryTracker,
} from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Use disposable state without process artifacts.
import { hostname, tmpdir } from "node:os";
import { inspectRepository, inspectRequest } from "./inspection.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Exercise the existing private SQLite boundary in disposable directories.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import type { LaunchReceipt } from "./launch.ts";
import type { RequestRecord } from "./request.ts";
import { colonyRequestSchema } from "@hive/shared";
import { explainRequest } from "./explain.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve disposable store paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { runCli } from "./cli.ts";

const EMPTY = 0;
const ONE = 1;
const TWO = 2;
const LARGE_HISTORY = 1000;
const OBSERVED = "2026-10-13T00:00:00Z";
const workspace = await mkdtemp(join(tmpdir(), "colony-explain-"));
const repository = { beadsDb: "/fixture/beads.db", root: workspace };
const tracker = { ...memoryTracker(), repository };
const taskId = await createTask(tracker);
await createWorkflowControl(tracker, taskId);
const target = await createSpawn(tracker, taskId);
const fixtures = await Promise.all([EMPTY, LARGE_HISTORY].map((size) => createFixture(size)));
for (const { store } of fixtures) {
	inspectRequest(repository, store, target);
}
inspectRepository(repository, fixtures[EMPTY]!.store);
const serverTarget = { state: workspace, socket: join(workspace, "s"), runtimeEntry: "/unused" };
const limits = { colony: TWO, kind: TWO, kinds: {}, worktree: TWO };
let selected = fixtures[EMPTY]!.store;
let unavailable = false;
const commands: unknown[] = [];
const server = Bun.serve({
	unix: serverTarget.socket,
	fetch: async (httpRequest) => {
		const command = colonyRequestSchema.parse(await httpRequest.json());
		commands.push(command);
		if (unavailable) {
			return Response.json({ kind: "error", message: "Selected runtime unavailable" });
		}
		if (command.kind !== "inspect-request") {
			throw new Error("Expected a focused diagnostic command");
		}
		return Response.json({
			...inspectRequest(command.repository, selected, command.requestId),
			colony: {
				intent: "awake",
				policy: { limits, ranking: "fifo" },
				registration: "durable",
				repository,
				state: "awake",
			},
		});
	},
});
const reports: Awaited<ReturnType<typeof invokeExplanation>>[] = [];
for (const fixture of fixtures) {
	selected = fixture.store;
	// eslint-disable-next-line no-await-in-loop -- Compare the same request against independently retained history sizes.
	reports.push(await invokeExplanation());
}
unavailable = true;
const partial = await invokeExplanation();
unavailable = false;
const missingRuntime = await explainRequest(target, tracker, {
	...serverTarget,
	socket: join(workspace, "missing"),
});

afterAll(async () => {
	await server.stop(true);
	await Promise.all(
		fixtures.map(async ({ store, database, state }) => {
			database.close();
			store.close();
			await rm(state, { force: true, recursive: true });
		}),
	);
	await rm(workspace, { force: true, recursive: true });
});

test("a repository without retained evidence has no checkpoint, attempts or reservations", () => {
	expect(
		inspectRequest({ ...repository, root: "/other" }, fixtures[EMPTY]!.store, target),
	).toMatchObject({
		attempts: [],
		checkpoint: null,
		occupied: [],
	});
});

test("public inspect retains complete target and other-request history", () => {
	const index = EMPTY;
	const historySize = EMPTY;
	const { store } = fixtures[index]!;
	const result = inspectRepository(repository, store);
	const liveAndTarget = 4;
	expect(result.attempts).toHaveLength(historySize + liveAndTarget);
	expect(result.requests).toHaveLength(historySize + TWO);
	expect(result.history).toHaveLength(historySize);
	expect(result.attempts.map(({ id }) => id)).toContain("target-exited");
	expect(result.requests.map(({ id }) => id)).toContain("other");
});

// eslint-disable-next-line max-statements -- Verify one public report across evidence groups.
test("explain JSON excludes unrelated history and preserves capacity and selected process evidence", () => {
	const [small, large] = reports;
	expect(large!.code).toBe(EMPTY);
	expect(large!.stderr).toBe("");
	expect(Buffer.byteLength(large!.stdout)).toBe(Buffer.byteLength(small!.stdout));
	expect(large!.stdout).not.toMatch(/history-|other-starting|other-running/u);
	const result = JSON.parse(large!.stdout);
	expect(result).toMatchObject({ ok: true, kind: "explanation", id: target });
	expect(result.runtime.result.value.colony).not.toHaveProperty("attempts");
	expect(result.runtime.result.value.checkpoint.id).toBe(target);
	expect(result.runtime.result.value.attempts.map(({ id }: { id: string }) => id)).toEqual([
		"target-failed",
		"target-exited",
	]);
	expect(result.capacity.result.value).toMatchObject({
		available: false,
		limits,
		occupied: [
			{ bucket: "/other-bucket", kind: "worker" },
			{ bucket: repository.root, kind: "librarian" },
		],
	});
	expect(result.processes.map(({ attemptId }: { attemptId: string }) => attemptId)).toEqual([
		"target-failed",
		"target-exited",
	]);
	expect(result.tracker.result.kind).toBe("available");
	expect(result.runtime.freshness).toBe("checkpoint_age_unknown");
	expect(commands).toEqual(
		Array.from({ length: 3 }, () => ({ kind: "inspect-request", repository, requestId: target })),
	);
});

test("failed and unavailable runtime reads preserve native evidence without falling back", () => {
	const report = JSON.parse(partial.stdout);
	expect(report).toMatchObject({
		ok: true,
		tracker: { result: { kind: "available" } },
		runtime: { result: { kind: "unavailable" } },
		capacity: { result: { kind: "unavailable" } },
	});
	expect(missingRuntime.runtime.result).toMatchObject({
		kind: "unavailable",
		reason: "daemon_unavailable",
	});
	expect(report.diagnostics.map(({ code }: { code: string }) => code)).toContain(
		"runtime_unavailable",
	);
});

test(
	"capacity preserves duplicate local reservations and excludes foreign, unbound " +
		"and orphan requests #test-538",
	// eslint-disable-next-line max-statements -- Compare all host membership variants against one capacity projection.
	() => {
		const { store, database } = fixtures[EMPTY]!;
		const root = "/host-capacity";
		store.saveRequest(root, request("local"));
		store.saveRequest(root, { ...request("foreign"), host: "another-host" });
		store.saveRequest(root, { ...request("unbound"), host: null });
		for (const id of ["local-first", "local-second", "foreign", "unbound", "orphan"]) {
			let spawnId = id;
			if (id.startsWith("local-")) {
				spawnId = "local";
			}
			insertAttempt(database, root, receipt(id, spawnId), "running");
		}
		expect(store.retainedOccupants(root)).toEqual([
			{ bucket: repository.root, kind: "worker" },
			{ bucket: repository.root, kind: "worker" },
		]);
	},
);

test("checkpoint point reads return fresh writes and do not hydrate unrelated records #test-539", () => {
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
	"$source authority rejects retained tracker $tracker #test-540",
	/* eslint-disable-next-line max-statements --
	 * Establish independent retained authority and check rejection after membership removal.
	 */
	({ source, tracker: retainedTracker }) => {
		const { database, store } = fixtures[EMPTY]!;
		const root = `/${source}${retainedTracker}`;
		const endpoint = { ...repository, root };
		if (source === "registration") {
			store.register({ beadsDb: retainedTracker, root });
		} else {
			store.register(endpoint);
			store.saveRequest(root, request("matching"));
			if (source === "checkpoint") {
				store.saveRequest(root, { ...request("conflict"), beadsDb: retainedTracker });
			} else {
				insertAttempt(database, root, receipt(`matching-${retainedTracker}`, "matching"), "exited");
				insertAttempt(
					database,
					root,
					{ ...receipt(`conflict-${retainedTracker}`, "conflict"), beadsDb: retainedTracker },
					"exited",
				);
			}
			store.remove(root);
		}
		expect(() => inspectRequest(endpoint, store, target)).toThrow(Error);
	},
);

// --- Private functions ---
async function createFixture(historySize: number) {
	const state = await mkdtemp(join(tmpdir(), "colony-inspection-"));
	const store = openStore(state);
	const database = new Database(join(state, "colony.sqlite"));
	/* eslint-disable-next-line max-statements --
	 * Build one SQLite history fixture, including target and other live reservations.
	 */
	database.transaction(() => {
		insertRequest(database, request(target));
		insertRequest(database, request("other"));
		insertAttempt(database, repository.root, receipt("target-failed", target), "failed");
		insertAttempt(database, repository.root, receipt("target-exited", target), "exited");
		insertAttempt(
			database,
			repository.root,
			{ ...receipt("other-starting", "other"), bucket: "/other-bucket" },
			"starting",
		);
		const running = receipt("other-running", "other");
		insertAttempt(
			database,
			repository.root,
			{ ...running, recipe: { ...running.recipe, kind: "librarian" } },
			"running",
		);
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
		assignment: { kind: "driver", runId: taskId },
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
			taskIds: [taskId],
		},
		host: hostname(),
		id,
		state: "waiting",
	};
}

function receipt(id: string, spawnId: string): LaunchReceipt {
	return {
		assignment: { kind: "driver", runId: taskId },
		attemptNumber: ONE,
		beadsDb: repository.beadsDb,
		bucket: repository.root,
		createdAt: OBSERVED,
		cwd: repository.root,
		directory: `/fixture/${id}`,
		formula: { argv: [], executable: "fixture", headless: [] },
		host: hostname(),
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
		taskIds: [taskId],
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

async function invokeExplanation() {
	let stdout = "";
	let stderr = "";
	const code = await runCli(["explain", target, "--json"], {
		loadSkills: unexpectedRead,
		executionClearance: () => {
			throw new Error("Unexpected clearance");
		},
		add: unexpectedRead,
		config: unexpectedRead,
		events: unexpectedRead,
		explain: (id) => explainRequest(id, tracker, serverTarget),
		init: unexpectedRead,
		inspect: unexpectedRead,
		launch: unexpectedRead,
		remove: unexpectedRead,
		restart: unexpectedRead,
		serve: unexpectedRead,
		sleep: unexpectedRead,
		status: unexpectedRead,
		stop: unexpectedRead,
		wake: unexpectedRead,
		stdout: (text) => {
			stdout += text;
		},
		stderr: (text) => {
			stderr += text;
		},
	});
	return { code, stdout, stderr };
}
