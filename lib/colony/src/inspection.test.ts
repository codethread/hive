/* eslint-disable node/no-sync -- Avoid async scheduling for disposable directories; keep setup and cleanup measured. */
/* eslint-disable import/max-dependencies -- Compose real SQLite, Unix socket and CLI paths with a memory tracker. */
/* eslint-disable unicorn/no-null -- Retained fixtures preserve absent checkpoint and policy fields. */
import {
	createSpawn,
	createTask,
	createWorkflowControl,
	memoryTracker,
} from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Use disposable state without process artifacts.
import { hostname, tmpdir } from "node:os";
import { inspectRepository, inspectRequest } from "./inspection.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Exercise the existing private SQLite boundary in disposable directories.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { LaunchReceipt } from "./launch.ts";
import type { RequestRecord } from "./request.ts";
import type { ServerTarget } from "./client.ts";
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
const limits = { colony: TWO, kind: TWO, kinds: {}, worktree: TWO };

type Fixture = Awaited<ReturnType<typeof createFixture>>;
type Context = Awaited<ReturnType<typeof createContext>>;

test(
	"public inspection retains history while explain JSON scopes evidence " +
		"across history sizes #test-682",
	async () => {
		await withFixture(EMPTY, async (small) => {
			const { repository, store, target } = small;
			expect(inspectRequest({ ...repository, root: "/other" }, store, target)).toMatchObject({
				attempts: [],
				checkpoint: null,
				occupied: [],
			});
			const snapshot = inspectRepository(repository, store);
			const liveAndTarget = 4;
			expect(snapshot.attempts).toHaveLength(liveAndTarget);
			expect(snapshot.requests).toHaveLength(TWO);
			expect(snapshot.history).toHaveLength(EMPTY);
			expect(snapshot.attempts.map(({ id }) => id)).toContain("target-exited");
			expect(snapshot.requests.map(({ id }) => id)).toContain("other");
			// Keep request identity fixed while comparing independent retained histories.
			await withFixture(
				LARGE_HISTORY,
				// eslint-disable-next-line max-statements -- Verify one public report across evidence groups.
				async (large) => {
					let selected = small.store;
					const { server, serverTarget, commands } = serveInspection(small, () =>
						inspectRequest(repository, selected, target),
					);
					try {
						const smallReport = await invokeExplanation(small, serverTarget);
						selected = large.store;
						const largeReport = await invokeExplanation(large, serverTarget);
						expect(largeReport.code).toBe(EMPTY);
						expect(largeReport.stderr).toBe("");
						expect(Buffer.byteLength(largeReport.stdout)).toBe(
							Buffer.byteLength(smallReport.stdout),
						);
						expect(largeReport.stdout).not.toMatch(/history-|other-starting|other-running/u);
						const result = JSON.parse(largeReport.stdout);
						expect(result).toMatchObject({ ok: true, kind: "explanation", id: target });
						expect(result.runtime.result.value.colony).not.toHaveProperty("attempts");
						expect(result.runtime.result.value.checkpoint.id).toBe(target);
						expect(
							result.runtime.result.value.attempts.map(({ id }: { id: string }) => id),
						).toEqual(["target-failed", "target-exited"]);
						expect(result.capacity.result.value).toMatchObject({
							available: false,
							limits,
							occupied: [
								{ bucket: "/other-bucket", kind: "worker" },
								{ bucket: repository.root, kind: "librarian" },
							],
						});
						expect(
							result.processes.map(({ attemptId }: { attemptId: string }) => attemptId),
						).toEqual(["target-failed", "target-exited"]);
						expect(result.tracker.result).toMatchObject({
							kind: "available",
							value: { eligibility: "eligible" },
						});
						expect(result.runtime.freshness).toBe("checkpoint_age_unknown");
						expect(commands).toEqual(
							Array.from({ length: TWO }, () => ({
								kind: "inspect-request",
								repository,
								requestId: target,
							})),
						);
					} finally {
						await server.stop(true);
					}
				},
				small,
			);
		});
	},
);

test("failed and unavailable runtime reads preserve native evidence without falling back #test-683", async () => {
	await withContext(async (fixture) => {
		const { server, serverTarget, commands } = serveInspection(fixture, () => ({
			kind: "error",
			message: "Selected runtime unavailable",
		}));
		try {
			const partial = await invokeExplanation(fixture, serverTarget);
			const missingRuntime = await explainRequest(fixture.target, fixture.tracker, {
				...serverTarget,
				socket: join(fixture.state, "missing"),
			});
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
			expect(commands).toEqual([
				{ kind: "inspect-request", repository: fixture.repository, requestId: fixture.target },
			]);
		} finally {
			await server.stop(true);
		}
	});
});

test(
	"capacity preserves duplicate local reservations and excludes foreign, unbound " +
		"and orphan requests #test-538",
	async () => {
		await withFixture(null, ({ store, database, repository, taskId }) => {
			const root = "/host-capacity";
			database.transaction(() => {
				insertRequest(database, request("local", taskId, repository.beadsDb), root);
				insertRequest(
					database,
					{ ...request("foreign", taskId, repository.beadsDb), host: "another-host" },
					root,
				);
				insertRequest(
					database,
					{ ...request("unbound", taskId, repository.beadsDb), host: null },
					root,
				);
				for (const id of ["local-first", "local-second", "foreign", "unbound", "orphan"]) {
					let spawnId = id;
					if (id.startsWith("local-")) {
						spawnId = "local";
					}
					insertAttempt(database, root, receipt(id, spawnId, { taskId, repository }), "running");
				}
			})();
			expect(store.retainedOccupants(root)).toEqual([
				{ bucket: repository.root, kind: "worker" },
				{ bucket: repository.root, kind: "worker" },
			]);
		});
	},
);

test("checkpoint point reads return fresh writes and omit missing requests #test-539", async () => {
	await withFixture(null, (fixture) => {
		const { repository, target, taskId } = fixture;
		fixture.store.saveRequest(repository.root, request(target, taskId, repository.beadsDb));
		const record = fixture.store.request(repository.root, target)!;
		const message = "Fresh reconciliation";
		fixture.store.saveRequest(repository.root, {
			...record,
			context: { ...record.context, message },
		});
		expect(fixture.store.request(repository.root, target)?.context.message).toBe(message);
		expect(fixture.store.request(repository.root, "missing")).toBeUndefined();
	});
});

test.each([
	{ source: "registration", tracker: "/a.db" },
	{ source: "checkpoint", tracker: "/a.db" },
	{ source: "checkpoint", tracker: "/z.db" },
	{ source: "attempt", tracker: "/a.db" },
	{ source: "attempt", tracker: "/z.db" },
])(
	"$source authority rejects retained tracker $tracker #test-540",
	async ({ source, tracker: retainedTracker }) => {
		/* eslint-disable-next-line max-statements --
		 * Check tracker conflicts from registration or evidence retained after membership removal.
		 */
		await withFixture(null, (fixture) => {
			const { database, store, repository, taskId, target } = fixture;
			const root = `/${source}${retainedTracker}`;
			const endpoint = { ...repository, root };
			if (source === "registration") {
				store.register({ beadsDb: retainedTracker, root });
			} else {
				store.register(endpoint);
				database.transaction(() => {
					insertRequest(database, request("matching", taskId, repository.beadsDb), root);
					if (source === "checkpoint") {
						insertRequest(
							database,
							{ ...request("conflict", taskId, repository.beadsDb), beadsDb: retainedTracker },
							root,
						);
					} else {
						insertAttempt(
							database,
							root,
							receipt(`matching-${retainedTracker}`, "matching", fixture),
							"exited",
						);
						insertAttempt(
							database,
							root,
							{
								...receipt(`conflict-${retainedTracker}`, "conflict", fixture),
								beadsDb: retainedTracker,
							},
							"exited",
						);
					}
				})();
				store.remove(root);
			}
			expect(() => inspectRequest(endpoint, store, target)).toThrow(Error);
		});
	},
);

// --- Private functions ---
async function withFixture(
	historySize: number | null,
	run: (fixture: Fixture) => Promise<void> | void,
	context?: Context,
): Promise<void> {
	const fixture = await createFixture(context);
	try {
		if (historySize !== null) {
			retainHistory(fixture, historySize);
		}
		await run(fixture);
	} finally {
		fixture.database.close();
		fixture.store.close();
		rmSync(fixture.state, { force: true, recursive: true });
	}
}

async function withContext(
	run: (context: Context & { state: string }) => Promise<void>,
): Promise<void> {
	const state = mkdtempSync(join(tmpdir(), "colony-unavailable-"));
	try {
		await run({ ...(await createContext(state)), state });
	} finally {
		rmSync(state, { force: true, recursive: true });
	}
}

async function createContext(root: string) {
	const repository = { beadsDb: "/fixture/beads.db", root };
	const tracker = { ...memoryTracker(), repository };
	const taskId = await createTask(tracker);
	await createWorkflowControl(tracker, taskId);
	const target = await createSpawn(tracker, taskId);
	return { repository, tracker, taskId, target };
}

async function createFixture(context?: Context) {
	const state = mkdtempSync(join(tmpdir(), "colony-inspection-"));
	const selectedContext = context ?? (await createContext(state));
	const store = openStore(state);
	const database = new Database(join(state, "colony.sqlite"));
	return { ...selectedContext, database, state, store };
}

function retainHistory(fixture: Fixture, historySize: number): void {
	const { database, repository, taskId, target } = fixture;
	/* eslint-disable-next-line max-statements --
	 * Build one SQLite history fixture, including target and other live reservations.
	 */
	database.transaction(() => {
		insertRequest(database, request(target, taskId, repository.beadsDb), repository.root);
		insertRequest(database, request("other", taskId, repository.beadsDb), repository.root);
		insertAttempt(database, repository.root, receipt("target-failed", target, fixture), "failed");
		insertAttempt(database, repository.root, receipt("target-exited", target, fixture), "exited");
		insertAttempt(
			database,
			repository.root,
			{ ...receipt("other-starting", "other", fixture), bucket: "/other-bucket" },
			"starting",
		);
		const running = receipt("other-running", "other", fixture);
		insertAttempt(
			database,
			repository.root,
			{ ...running, recipe: { ...running.recipe, kind: "librarian" } },
			"running",
		);
		for (let index = EMPTY; index < historySize; index += ONE) {
			const id = `history-${index}`;
			insertRequest(database, request(id, taskId, repository.beadsDb), repository.root);
			insertAttempt(database, repository.root, receipt(id, id, fixture), "exited");
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
}

function serveInspection(
	fixture: Context & { state: string },
	inspect: () => ReturnType<typeof inspectRequest> | { kind: "error"; message: string },
) {
	const { repository, state } = fixture;
	const serverTarget = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
	const commands: unknown[] = [];
	const server = Bun.serve({
		unix: serverTarget.socket,
		fetch: async (httpRequest) => {
			const command = colonyRequestSchema.parse(await httpRequest.json());
			commands.push(command);
			if (command.kind !== "inspect-request") {
				throw new Error("Expected a focused diagnostic command");
			}
			const result = inspect();
			if (result.kind === "error") {
				return Response.json(result);
			}
			return Response.json({
				...result,
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
	return { server, serverTarget, commands };
}

function request(id: string, taskId: string, beadsDb: string): RequestRecord {
	return {
		assignment: { kind: "driver", runId: taskId },
		beadsDb,
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

function receipt(
	id: string,
	spawnId: string,
	{ repository, taskId }: Pick<Context, "repository" | "taskId">,
): LaunchReceipt {
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

function insertRequest(database: Database, record: RequestRecord, root: string): void {
	database
		.query("INSERT INTO requests VALUES (?, ?, ?)")
		.run(root, record.id, JSON.stringify(record));
}

function unexpectedRead(): never {
	throw new Error("Diagnostic must not load unrelated history");
}

async function invokeExplanation({ target, tracker }: Context, serverTarget: ServerTarget) {
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
