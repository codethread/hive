/* eslint-disable import/max-dependencies -- Reconcile native requests with real owned-process fixtures. */
/* eslint-disable unicorn/no-null -- Request receipts preserve absent policy revisions explicitly. */
import { afterAll, expect, mock, test } from "bun:test";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { claimRequest, newRequest, reconcileRequests, transitionRequest } from "./request.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and clean state directories outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import type { LaunchReceipt } from "./launch.ts";
import type { Store } from "./store.ts";
import type { WorkflowAssignment } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Use the established disposable private SQLite fixture boundary.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { startOwnedTestExecution } from "./owned-execution.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate disposable state, never the running Colony's database.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;
const ONCE = 1;
const state = await mkdtemp(join(tmpdir(), "colony-request-authority-"));
const store = openStore(state);
const config = beesConfigSchema.parse({ formulas: {}, humans: ["ct"], owner: "ct" });
// Operation evidence is orthogonal to authority; mirror claims.test.ts's no-op evidence.
const history: Store["history"] = {
	run: (_input, action) =>
		action({
			completed: () => {},
			failed: () => {},
			reference: () => {},
			step: () => {},
		}),
};
const cases = ["role", "run", "stage", "host", "identity", "tasks"];
afterAll(async () => {
	store.close();
	await rm(state, { force: true, recursive: true });
});

test.each(cases)(
	"#test-100 recovery rejects a restored receipt %s mismatch before inventory or process effects",
	async (name) => {
		const fixture = await recoveryFixture(name);
		const inventory = mock(() => Promise.reject(new Error("Unexpected inventory refresh")));
		await expect(
			reconcileRequests({
				...fixture.tracker,
				config,
				store: { ...store, history, inventory },
			}),
		).rejects.toBeInstanceOf(Error);
		expect(inventory).not.toHaveBeenCalled();
		expect(store.requests(fixture.tracker.repository.root)).toEqual([fixture.saved]);
		expect(await fixture.tracker.beads.show(fixture.scope, fixture.taskId)).toEqual(fixture.task);
	},
);

test.each(["driver", "stage"] as const)(
	"#test-104 unchanged %s authority continues after private checkpoint restoration",
	// eslint-disable-next-line max-statements -- Restore and exercise the complete request retry and settlement path.
	async (kind) => {
		const fixture = await recoveryFixture(`unchanged-${kind}`, kind);
		const { root } = fixture.tracker.repository;
		fixture.saved = store.advanceRequest(root, fixture.saved, {
			type: "SETTLE",
			outcome: null,
			message: "Retry unfinished work",
		});
		fixture.saved = store.advanceRequest(root, fixture.saved, { type: "RELEASED" });
		fixture.saved = store.advanceRequest(root, fixture.saved, {
			type: "SETTLED",
			now: 0,
			maxRetries: 2,
			delay: 2,
		});
		fixture.saved = store.advanceRequest(root, fixture.saved, { type: "TICK", now: 2 });
		const inventory = mock(() => Promise.resolve([]));
		await reconcileRequests({
			...fixture.tracker,
			config,
			store: { ...store, history, inventory },
		});
		expect(inventory).toHaveBeenCalledTimes(ONCE);
		expect(store.requests(fixture.tracker.repository.root)).toEqual([fixture.saved]);
		expect(fixture.saved.state).toBe("waiting");
		await assertSettlementAttribution(fixture);
	},
);

// --- Fixtures ---
// eslint-disable-next-line max-statements -- Verify native settlement attribution and its restored checkpoint together.
async function assertSettlementAttribution(
	fixture: Awaited<ReturnType<typeof recoveryFixture>>,
): Promise<void> {
	const { tracker, saved, scope, taskId } = fixture;
	let anchorScope = "run";
	if (saved.assignment.kind === "stage") {
		anchorScope = "visit";
	}
	await tracker.beads.close(scope, taskId, {
		reason: JSON.stringify({
			kind: "busybee-lifecycle",
			formatVersion: 1,
			scope: anchorScope,
			runId: saved.assignment.runId,
			outcome: "succeeded",
			reason: "Completed",
		}),
	});
	const close = mock(tracker.beads.close);
	const update = mock(tracker.beads.update);
	await reconcileRequests({
		...tracker,
		beads: { ...tracker.beads, close, update },
		config,
		store: { ...store, history, inventory: () => Promise.resolve([]) },
	});
	const result = await tracker.beads.show(scope, saved.id);
	expect(close.mock.calls.map(([operation]) => operation.actor)).toEqual(["sys-colony"]);
	expect(update.mock.calls.map(([operation]) => operation.actor)).toEqual(["sys-colony"]);
	expect(result).toMatchObject({
		status: "closed",
		close_reason: "completed",
		labels: expect.arrayContaining(["bee-outcome:succeeded", "bee-resolution:resolved"]),
	});
	expect(store.requests(tracker.repository.root)[FIRST]?.state).toBe("terminal");
}

// Seed genuine native/receipt/checkpoint authority through existing memory and SQLite adapters.
// eslint-disable-next-line max-statements
async function recoveryFixture(name: string, kind: WorkflowAssignment["kind"] = "stage") {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: `/fixture/${name}` };
	const run = await createTask(tracker);
	const taskId = await createTask(tracker, {
		parent: run,
		assignee: "worker",
		status: "in_progress",
	});
	const id = await createSpawn(tracker, taskId);
	const scope = trackerScope(tracker.repository, "worker");
	const initial = await tracker.beads.show(scope, id);
	const captured = readSpawnRequest(initial);
	let assignment: WorkflowAssignment = { kind: "driver", runId: taskId };
	if (kind === "stage") {
		assignment = { kind, runId: run, stageId: taskId };
	}
	await tracker.beads.update(scope, [id], {
		description: JSON.stringify({ ...captured.recipe, host: captured.host, assignment }),
	});
	const spawn = await tracker.beads.show(scope, id);
	const record = newRequest(spawn, tracker.repository);
	const receipt: LaunchReceipt = {
		assignment,
		attemptNumber: 1,
		beadsDb: tracker.repository.beadsDb,
		bucket: tracker.repository.root,
		createdAt: "2026-10-13T00:00:00.000Z",
		cwd: tracker.repository.root,
		directory: join(state, name),
		formula: { argv: [], executable: "fixture", headless: [] },
		host: record.host,
		id: name,
		identity: record.context.identity,
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: captured.recipe,
		spawnId: id,
		taskIds: [taskId],
		token: name,
	};
	const edits: Record<string, Partial<LaunchReceipt>> = {
		role: { assignment: { kind: "driver", runId: taskId } },
		run: { assignment: { kind: "stage", runId: "another-run", stageId: taskId } },
		stage: { assignment: { kind: "stage", runId: run, stageId: "another-stage" } },
		host: { host: "another-host" },
		identity: { identity: "another-bee" },
		tasks: { taskIds: ["another-task"] },
	};
	const claiming = transitionRequest(record, { type: "READY" });
	store.reserve(tracker.repository.root, { ...receipt, ...edits[name] }, claiming);
	// Validate the immutable receipt boundary independently of the expected authority rejection.
	store.retainedInventory(tracker.repository.root);
	const saved = store.requests(tracker.repository.root)[FIRST]!;
	const task = await tracker.beads.show(scope, taskId);
	return { tracker, saved, scope, taskId, task };
}

const dispositions = [
	{ outcome: "succeeded", requestOutcome: "completed", label: "succeeded" },
	{ outcome: "cancelled", requestOutcome: "cancelled", label: "cancelled" },
	{ outcome: "failed", requestOutcome: "blocked", label: "failed" },
] as const;

test.each(
	dispositions.flatMap((item) => [
		{ ...item, path: "acquisition" },
		{ ...item, path: "unlaunched" },
	]),
)(
	"#test-109 $path request settles native $outcome anchor as $requestOutcome",
	/* eslint-disable-next-line max-statements --
	 * Verify acquisition and native request publication in one measured scenario.
	 */
	async ({ outcome, requestOutcome, label, path }) => {
		const tracker = memoryTracker();
		tracker.repository = { ...tracker.repository, root: `/fixture/${path}-${outcome}` };
		const taskId = await createTask(tracker);
		const id = await createSpawn(tracker, taskId);
		const scope = trackerScope(tracker.repository, "worker");
		const record = newRequest(await tracker.beads.show(scope, id), tracker.repository);
		store.saveRequest(tracker.repository.root, record);
		await tracker.beads.close(scope, taskId, {
			reason: JSON.stringify({
				kind: "busybee-lifecycle",
				formatVersion: 1,
				scope: "run",
				runId: taskId,
				outcome,
				reason: "Native disposition",
			}),
		});
		const runtime = {
			...tracker,
			config,
			store: { ...store, history, inventory: () => Promise.resolve([]) },
		};
		if (path === "acquisition") {
			expect(await claimRequest(runtime, record)).toBeNull();
		} else {
			await reconcileRequests(runtime);
		}
		expect(store.requests(tracker.repository.root)[FIRST]).toMatchObject({
			state: "terminal",
			context: { outcome: requestOutcome, attempts: 0, claims: [] },
		});
		expect(await tracker.beads.show(scope, id)).toMatchObject({
			status: "closed",
			close_reason: requestOutcome,
			labels: expect.arrayContaining([`bee-outcome:${label}`]),
		});
	},
);

test.each(["acquisition", "unlaunched"])(
	"%s rejects an unclassified anchor without request success",
	/* eslint-disable-next-line max-statements --
	 * Preserve the unchanged native request and checkpoint on diagnostic failure.
	 */
	async (path) => {
		const tracker = memoryTracker();
		tracker.repository = { ...tracker.repository, root: `/fixture/legacy-${path}` };
		const taskId = await createTask(tracker, { status: "closed" });
		const id = await createSpawn(tracker, taskId);
		const scope = trackerScope(tracker.repository, "worker");
		const record = newRequest(await tracker.beads.show(scope, id), tracker.repository);
		store.saveRequest(tracker.repository.root, record);
		const runtime = {
			...tracker,
			config,
			store: { ...store, history, inventory: () => Promise.resolve([]) },
		};
		const operation = () => {
			if (path === "acquisition") {
				return claimRequest(runtime, record);
			}
			return reconcileRequests(runtime);
		};
		await expect(operation()).rejects.toBeInstanceOf(Error);
		expect(await tracker.beads.show(scope, id)).toMatchObject({ status: "open" });
		expect(store.requests(tracker.repository.root)).toEqual([record]);
	},
);

test.each(
	dispositions.flatMap((item) => [
		{ ...item, path: "exit" },
		{ ...item, path: "finish" },
		{ ...item, path: "running" },
	]),
)(
	"#test-96 $path execution respects native $outcome anchor as $requestOutcome",
	/* eslint-disable-next-line max-statements --
	 * Exercise real process ownership, lifecycle publication and cleanup together.
	 */
	async ({ outcome, requestOutcome, path }) => {
		const fixture = await executionFixture(`${path}-${outcome}`);
		const { tracker, scope, id, taskId, receipt, record } = fixture;
		const execution = await startOwnedTestExecution(receipt);
		try {
			await tracker.beads.close(scope, taskId, {
				reason: JSON.stringify({
					kind: "busybee-lifecycle",
					formatVersion: 1,
					scope: "run",
					runId: taskId,
					outcome,
					reason: "Native disposition",
				}),
			});
			if (path === "exit") {
				await execution.close();
			}
			if (path === "finish") {
				await Bun.write(
					join(receipt.directory, "finish.json"),
					JSON.stringify({
						attemptId: receipt.id,
						spawnId: id,
						token: receipt.token,
						result: { outcome: "success" },
					}),
				);
			}
			const runtime = {
				...tracker,
				config,
				store: {
					...store,
					history,
					inventory: () =>
						Promise.resolve([{ id: receipt.id, spawnId: id, receipt, state: "running" as const }]),
				},
			};
			await reconcileRequests(runtime);
			const saved = store.requests(tracker.repository.root)[FIRST]!;
			const native = await tracker.beads.show(scope, id);
			if (path === "running" && outcome === "succeeded") {
				expect(saved.state).toBe("executing");
				expect(native.status).toBe("open");
				expect(execution.supervisor.exitCode).toBeNull();
			} else {
				expect(saved).toMatchObject({
					state: "terminal",
					context: { outcome: requestOutcome, attempts: 1 },
				});
				expect(native).toMatchObject({ status: "closed", close_reason: requestOutcome });
			}
			expect(record.context.attempts).toBe(ONCE);
		} finally {
			await execution.close();
		}
	},
);

/* eslint-disable-next-line max-statements --
 * Capture native assignment and reserve its real disposable execution artifacts.
 */
async function executionFixture(name: string) {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: `/fixture/owned-${name}` };
	const taskId = await createTask(tracker, { assignee: "worker", status: "in_progress" });
	const id = await createSpawn(tracker, taskId);
	const scope = trackerScope(tracker.repository, "worker");
	const native = await tracker.beads.show(scope, id);
	const request = readSpawnRequest(native);
	const directory = await mkdtemp(join(state, "owned-"));
	const receipt: LaunchReceipt = {
		assignment: request.assignment,
		attemptNumber: 1,
		beadsDb: tracker.repository.beadsDb,
		bucket: tracker.repository.root,
		createdAt: "2026-10-18T00:00:00Z",
		cwd: tracker.repository.root,
		directory,
		formula: { executable: "fixture", argv: [], headless: [] },
		host: request.host,
		id: crypto.randomUUID(),
		identity: request.identity,
		invocation: { executable: "fixture", argv: [] },
		policyRevisionId: null,
		recipe: request.recipe,
		spawnId: id,
		taskIds: request.taskIds,
		token: crypto.randomUUID(),
	};
	let record = newRequest(native, tracker.repository);
	record = transitionRequest(record, { type: "READY" });
	record = transitionRequest(record, { type: "ACQUIRED", id: taskId });
	record = store.reserve(tracker.repository.root, receipt, record);
	return { tracker, scope, id, taskId, receipt, record };
}

test.each(["exit", "self-success", "self-blocked"])(
	"#test-97 %s with unfinished workflow preserves the pending run",
	/* eslint-disable-next-line max-statements --
	 * Verify real exit, request retry/blocked policy and independent run history.
	 */
	async (path) => {
		const { tracker, scope, id, taskId, receipt } = await executionFixture(path);
		const execution = await startOwnedTestExecution(receipt);
		await execution.close();
		if (path !== "exit") {
			let result: { outcome: "success" } | { outcome: "blocked"; reason: string } = {
				outcome: "success",
			};
			if (path === "self-blocked") {
				result = { outcome: "blocked", reason: "Explicit worker blocker" };
			}
			await Bun.write(
				join(receipt.directory, "finish.json"),
				JSON.stringify({ attemptId: receipt.id, spawnId: id, token: receipt.token, result }),
			);
		}
		await reconcileRequests({
			...tracker,
			config,
			store: {
				...store,
				history,
				inventory: () =>
					Promise.resolve([{ id: receipt.id, spawnId: id, receipt, state: "exited" as const }]),
			},
		});
		const saved = store.requests(tracker.repository.root)[FIRST]!;
		const native = await tracker.beads.show(scope, id);
		const run = await tracker.beads.show(scope, taskId);
		if (path === "self-blocked") {
			expect(saved).toMatchObject({ state: "terminal", context: { outcome: "blocked" } });
			expect(native).toMatchObject({ status: "closed", close_reason: "blocked" });
		} else {
			expect(saved).toMatchObject({ state: "retrying", context: { outcome: null } });
			expect(native.status).toBe("open");
		}
		expect(run.status).toBe("open");
		expect(run.close_reason).toBeUndefined();
	},
);

test.each(["exit", "finish"])(
	"#test-98 %s cannot turn an unclassified closure into request success",
	/* eslint-disable-next-line max-statements --
	 * Exercise native legacy closure through the real owned-exit and finish boundaries.
	 */
	async (path) => {
		const { tracker, scope, id, taskId, receipt } = await executionFixture(`legacy-${path}`);
		const execution = await startOwnedTestExecution(receipt);
		await execution.close();
		await tracker.beads.close(scope, taskId, { reason: "Completed by old engine" });
		if (path === "finish") {
			await Bun.write(
				join(receipt.directory, "finish.json"),
				JSON.stringify({
					attemptId: receipt.id,
					spawnId: id,
					token: receipt.token,
					result: { outcome: "success" },
				}),
			);
		}
		await expect(
			reconcileRequests({
				...tracker,
				config,
				store: {
					...store,
					history,
					inventory: () =>
						Promise.resolve([{ id: receipt.id, spawnId: id, receipt, state: "exited" as const }]),
				},
			}),
		).rejects.toBeInstanceOf(Error);
		expect(await tracker.beads.show(scope, id)).toMatchObject({ status: "open" });
		expect(store.requests(tracker.repository.root)[FIRST]).toMatchObject({
			state: "executing",
			context: { outcome: null },
		});
	},
);
