/* eslint-disable unicorn/no-null -- Request receipts preserve absent policy revisions explicitly. */
import { afterAll, expect, mock, test } from "bun:test";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and clean state directories outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import { newRequest, reconcileRequests, transitionRequest } from "./request.ts";
import type { LaunchReceipt } from "./launch.ts";
import type { Store } from "./store.ts";
import type { WorkflowAssignment } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Use the established disposable private SQLite fixture boundary.
import { join } from "node:path";
import { openStore } from "./store.ts";
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

// --- Fixtures ---
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
