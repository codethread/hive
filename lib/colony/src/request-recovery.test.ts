/* eslint-disable unicorn/no-null -- Request receipts preserve absent policy revisions explicitly. */
/* eslint-disable import/max-dependencies --
 * Exercise dispatch, acquisition and reconciliation at the existing memory/store seams.
 */
import { afterAll, expect, mock, test } from "bun:test";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { claimRequest, newRequest, reconcileRequests, transitionRequest } from "./request.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and clean state directories outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import type { LaunchReceipt } from "./launch.ts";
import type { Store } from "./store.ts";
import type { WorkflowAssignment } from "@hive/shared";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate the isolated request fixture artifacts.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate disposable state, never the running Colony's database.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;
const ONCE = 1;
const LISTS_PER_PASS = 2;
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
const fixtures = new Map<string, Awaited<ReturnType<typeof recoveryFixture>>>();
for (const name of cases) {
	// eslint-disable-next-line no-await-in-loop -- Seed isolated repository checkpoints outside behavior timing.
	fixtures.set(name, await recoveryFixture(name));
}
const continuation = {
	driver: await recoveryFixture("unchanged-driver", "driver"),
	stage: await recoveryFixture("unchanged-stage", "stage"),
};
for (const fixture of Object.values(continuation)) {
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
}
const pollingTracker = memoryTracker();
pollingTracker.repository = { ...pollingTracker.repository, root: "/fixture/batched-poll" };
const pollingRecords = await Promise.all(
	["first", "second"].map(() => pollingFixture(pollingTracker)),
);
await dispatch({ ...pollingTracker, state, store: { ...store, history } }, config, "fixture");
const pollingInput = pollingInputFixture();
const cancelled = await cancellationFixture();
const missingTracker = memoryTracker();
missingTracker.repository = { ...missingTracker.repository, root: "/fixture/missing-batch" };
await pollingFixture(missingTracker);
const nativeDriftFields = ["host", "identity", "assignment", "tasks"];
const nativeDrift = new Map(
	await Promise.all(
		nativeDriftFields.map(async (field) => [field, await nativeDriftFixture(field)] as const),
	),
);
afterAll(async () => {
	store.close();
	await rm(state, { force: true, recursive: true });
});

test.each(cases)(
	"recovery rejects a restored receipt %s mismatch before inventory or process effects #test-519",
	async (name) => {
		const fixture = fixtures.get(name)!;
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
	"unchanged %s authority continues after private checkpoint restoration #test-344",
	async (kind) => {
		const fixture = continuation[kind];
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

/* eslint-disable-next-line max-statements --
 * Compare complete pass reads and preserved checkpoints at the service boundary.
 */
test("retained nonwaiting requests share one native detail batch per pass", async () => {
	const { input, show, showMany, list } = pollingInput;
	const tracker = pollingTracker;
	const records = pollingRecords;
	await dispatch(input, config, "fixture");
	expect(showMany.mock.calls.map(([, ids]) => ids)).toEqual([records.map(({ id }) => id)]);
	expect(show.mock.calls.map(([, id]) => id)).toEqual(
		records.flatMap(({ context }) => context.taskIds),
	);
	expect(list).toHaveBeenCalledTimes(LISTS_PER_PASS);
	expect(input.store.requests(tracker.repository.root)).toEqual(records);
});

test("an incomplete native retained-request batch fails before inventory", async () => {
	const tracker = missingTracker;
	const inventory = mock(() => Promise.resolve([]));
	await expect(
		reconcileRequests({
			...tracker,
			beads: { ...tracker.beads, showMany: () => Promise.resolve([]) },
			config,
			store: { ...store, history, inventory },
		}),
	).rejects.toBeInstanceOf(Error);
	expect(inventory).not.toHaveBeenCalled();
});

/* eslint-disable-next-line max-statements --
 * Check that cancellation leaves task claims and the pending checkpoint untouched.
 */
test("native cancellation blocks acquisition before any claim", async () => {
	const { tracker, taskId, id, scope, record } = cancelled;
	const update = mock(tracker.beads.update);
	const show = mock(tracker.beads.show);
	const runtime = {
		...tracker,
		beads: { ...tracker.beads, update, show },
		config,
		store: { ...store, history },
	};
	expect(await claimRequest(runtime, record)).toBeNull();
	expect(update).not.toHaveBeenCalled();
	expect(show.mock.calls.map(([, target]) => target)).toEqual([id]);
	expect(store.requests(tracker.repository.root)).toEqual([record]);

	expect(await tracker.beads.show(scope, id)).toMatchObject({
		status: "closed",
		close_reason: "Stopped by Bee",
	});
	expect(await tracker.beads.show(scope, taskId)).toMatchObject({ status: "open" });
});

test.each(nativeDriftFields)(
	"batched reconciliation rejects native %s drift before inventory or mutations",
	async (field) => {
		const { tracker, record } = nativeDrift.get(field)!;
		const inventory = mock(() => Promise.resolve([]));
		const update = mock(tracker.beads.update);
		await expect(
			reconcileRequests({
				...tracker,
				beads: { ...tracker.beads, update },
				config,
				store: { ...store, history, inventory },
			}),
		).rejects.toBeInstanceOf(Error);
		expect(inventory).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(store.requests(tracker.repository.root)).toEqual([record]);
	},
);

// --- Fixtures ---
async function cancellationFixture() {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: "/fixture/cancelled-acquisition" };
	const taskId = await createTask(tracker);
	const id = await createSpawn(tracker, taskId);
	const scope = trackerScope(tracker.repository, "worker");
	const record = newRequest(await tracker.beads.show(scope, id), tracker.repository);
	store.saveRequest(tracker.repository.root, record);
	await tracker.beads.close(scope, id, { reason: "Stopped by Bee" });
	return { tracker, taskId, id, scope, record };
}

// eslint-disable-next-line max-statements -- Seed the edited native request before measuring reconciliation.
async function nativeDriftFixture(field: string) {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: `/fixture/native-${field}` };
	const record = await pollingFixture(tracker);
	const scope = trackerScope(tracker.repository, "editor");
	const spawn = await tracker.beads.show(scope, record.id);
	const captured = readSpawnRequest(spawn);
	if (field === "identity") {
		await tracker.beads.update(scope, [record.id], { assignee: "another-bee" });
	} else if (field === "tasks") {
		const another = await createTask(tracker);
		await tracker.beads.dep.add(scope, record.id, another, "related");
	} else {
		const payload = { ...captured.recipe, host: captured.host, assignment: captured.assignment };
		if (field === "host") {
			payload.host = "another-host";
		} else {
			payload.assignment = { kind: "driver", runId: "another-run" };
		}
		await tracker.beads.update(scope, [record.id], { description: JSON.stringify(payload) });
	}
	return { tracker, record };
}

async function pollingFixture(tracker: ReturnType<typeof memoryTracker>) {
	const task = await createTask(tracker, { status: "in_progress", assignee: "worker" });
	const id = await createSpawn(tracker, task);
	const scope = trackerScope(tracker.repository, "worker");
	let record = newRequest(await tracker.beads.show(scope, id), tracker.repository);
	for (const event of [
		{ type: "READY" },
		{ type: "START", id: "previous-attempt" },
		{ type: "SETTLE", outcome: null, message: "Unfinished" },
		{ type: "RELEASED" },
		{ type: "SETTLED", now: 0, maxRetries: 2, delay: Number.MAX_SAFE_INTEGER },
	] as const) {
		record = transitionRequest(record, event);
	}
	store.saveRequest(tracker.repository.root, record);
	return record;
}

async function assertSettlementAttribution(fixture: typeof continuation.driver): Promise<void> {
	const { tracker, saved, scope, taskId } = fixture;
	await tracker.beads.close(scope, taskId, { reason: "Completed" });
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
	const taskId = await createTask(tracker, { assignee: "worker", status: "in_progress" });
	const id = await createSpawn(tracker, taskId);
	const scope = trackerScope(tracker.repository, "worker");
	const initial = await tracker.beads.show(scope, id);
	const captured = readSpawnRequest(initial);
	let assignment: WorkflowAssignment = { kind: "driver", runId: taskId };
	if (kind === "stage") {
		assignment = { kind, runId: "run", stageId: taskId };
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
		stage: { assignment: { kind: "stage", runId: "run", stageId: "another-stage" } },
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

function pollingInputFixture() {
	const checkpoints = new Map(pollingRecords.map((record) => [record.id, record]));
	const tracker = pollingTracker;
	const show = mock(tracker.beads.show);
	const showMany = mock(async (...args: Parameters<typeof tracker.beads.showMany>) => {
		const details = await tracker.beads.showMany(...args);
		return details.toReversed();
	});
	const list = mock(tracker.beads.list);
	const input = {
		...tracker,
		beads: { ...tracker.beads, show, showMany, list },
		state,
		store: {
			...store,
			history,
			request: (_root: string, id: string) => checkpoints.get(id),
			requests: ((_root) => [...checkpoints.values()]) satisfies Store["requests"],
			saveRequest: ((_root, record) => {
				checkpoints.set(record.id, record);
			}) satisfies Store["saveRequest"],
			advanceRequest: ((_root, saved, event) => {
				const next = transitionRequest(saved, event);
				checkpoints.set(next.id, next);
				return next;
			}) satisfies Store["advanceRequest"],
			inventory: () => Promise.resolve([]),
			retainedInventory: () => [],
			retainedOccupants: () => [],
		},
	};
	return { input, show, showMany, list };
}
