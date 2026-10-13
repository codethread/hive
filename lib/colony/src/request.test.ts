/* eslint-disable unicorn/no-null -- Lifecycle events exercise explicit pending outcomes. */
import type { RequestEvent, RequestRecord } from "./request.ts";
import type { SpawnRequest, WorkflowAssignment } from "@hive/shared";
import {
	assertRequestAuthority,
	newRequest,
	requestRecordSchema,
	transitionRequest,
} from "./request.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { LaunchReceipt } from "./launch.ts";
import { readSpawnRequest } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

// Compile boundary schemas and seed native memory records outside behavior timing.
const driver = await authorityFixture("driver");
const stage = await authorityFixture("stage");
const fixtures = { driver, stage };
const FIRST = 0;
const ANCHOR = driver.request.taskIds[FIRST]!;
const DRIVER: WorkflowAssignment = { kind: "driver", runId: ANCHOR };
const STAGE: WorkflowAssignment = { kind: "stage", runId: "run", stageId: ANCHOR };
const events: RequestEvent[] = [
	{ type: "READY" },
	{ type: "INTEND", id: ANCHOR },
	{ type: "ACQUIRED", id: ANCHOR },
	{ type: "START", id: "attempt" },
	{ type: "SETTLE", outcome: null, message: "Retry unfinished work" },
	{ type: "RELEASED" },
	{ type: "SETTLED", now: 0, maxRetries: 2, delay: 2 },
	{ type: "TICK", now: 2 },
	{ type: "READY" },
	{ type: "START", id: "next-attempt" },
	{ type: "SETTLE", outcome: "completed", message: "Done" },
	{ type: "RELEASED" },
	{ type: "SETTLED", now: 2, maxRetries: 2, delay: 2 },
];
restore(driver.record);
// Warm XState's snapshot machinery outside the measured regression behavior.
let warmed = driver.record;
for (const event of events) {
	warmed = restore(transitionRequest(warmed, event));
}

test.each([DRIVER, STAGE])(
	"captured $kind authority survives retries and JSON restoration",
	(assignment) => {
		const fixture = fixtures[assignment.kind];
		let record = restore(fixture.record);
		expect(record.assignment).toEqual(assignment);
		for (const event of events) {
			record = restore(transitionRequest(record, event));
			expect(record.assignment).toEqual(assignment);
			assertRequestAuthority(record, fixture.request);
			assertRequestAuthority(record, receiptFor(fixture.request));
		}
		expect(record.state).toBe("terminal");
	},
);

test("checkpoint decoding requires the captured workflow authority", () => {
	const { assignment, ...missing } = driver.record;
	expect(assignment).toEqual(DRIVER);
	expect(requestRecordSchema.safeParse(missing).success).toBe(false);
	const malformed = { ...driver.record, assignment: { kind: "stage", runId: "run" } };
	expect(requestRecordSchema.safeParse(malformed).success).toBe(false);
});

test.each([
	{ captured: DRIVER, edited: STAGE },
	{ captured: STAGE, edited: DRIVER },
	{ captured: STAGE, edited: { ...STAGE, runId: "another-run" } },
])(
	"restored $captured.kind rejects a same-anchor native edit to $edited",
	({ captured, edited }) => {
		const fixture = fixtures[captured.kind];
		const restored = restore(fixture.record);
		const native = readSpawnRequest({
			...fixture.spawn,
			description: JSON.stringify({
				...fixture.request.recipe,
				host: fixture.request.host,
				assignment: edited,
			}),
		});
		expect(native.taskIds).toEqual(restored.context.taskIds);
		expect(() => assertRequestAuthority(restored, native)).toThrow(Error);
		expect(() => assertRequestAuthority(restored, receiptFor(native))).toThrow(Error);
	},
);

test.each([
	{ field: "assignment", value: DRIVER },
	{ field: "assignment", value: { ...STAGE, runId: "another-run" } },
	{ field: "assignment", value: { kind: "stage", runId: "run", stageId: "another-stage" } },
	{ field: "host", value: "another-host" },
	{ field: "identity", value: "another-bee" },
	{ field: "taskIds", value: ["another-stage"] },
])("restored authority rejects receipt changes to $field: $value", ({ field, value }) => {
	const restored = restore(stage.record);
	expect(() =>
		assertRequestAuthority(restored, { ...receiptFor(stage.request), [field]: value }),
	).toThrow(Error);
});

// --- Fixtures ---
// Capture a genuine native request through the shared memory fixture before timing tests.
// eslint-disable-next-line max-statements
async function authorityFixture(kind: WorkflowAssignment["kind"]) {
	const tracker = memoryTracker();
	const taskId = await createTask(tracker);
	let assignment: WorkflowAssignment = { kind: "driver", runId: taskId };
	if (kind === "stage") {
		assignment = { kind, runId: "run", stageId: taskId };
	}
	const id = await createSpawn(tracker, taskId);
	const scope = trackerScope(tracker.repository, "worker");
	const initial = await tracker.beads.show(scope, id);
	const decoded = readSpawnRequest(initial);
	await tracker.beads.update(scope, [id], {
		description: JSON.stringify({ ...decoded.recipe, host: decoded.host, assignment }),
	});
	const spawn = await tracker.beads.show(scope, id);
	const record = newRequest(spawn, tracker.repository);
	return { tracker, spawn, record, request: readSpawnRequest(spawn) };
}

function restore(record: RequestRecord): RequestRecord {
	// Exercise the JSON persistence boundary, not an in-memory clone.
	// eslint-disable-next-line unicorn/prefer-structured-clone
	const parsed: unknown = JSON.parse(JSON.stringify(record));
	return requestRecordSchema.parse(parsed);
}

function receiptFor(request: SpawnRequest): LaunchReceipt {
	return {
		assignment: request.assignment,
		attemptNumber: 1,
		beadsDb: driver.tracker.repository.beadsDb,
		bucket: "/fixture",
		createdAt: "2026-10-13T00:00:00.000Z",
		cwd: "/fixture",
		directory: "/fixture/attempt",
		formula: { argv: [], executable: "fixture", headless: [] },
		host: request.host,
		id: "attempt",
		identity: request.identity,
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: request.recipe,
		spawnId: request.id,
		taskIds: request.taskIds,
		token: "token",
	};
}
