/* eslint-disable unicorn/no-null -- Checkpoints and receipts preserve explicit absent values. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { newRequest, runningPublicationStillCurrent, transitionRequest } from "./request.ts";
import type { AttemptInventory } from "./store.ts";
import type { LaunchReceipt } from "./launch.ts";
import { readSpawnRequest } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const tracker = memoryTracker();
const taskId = await createTask(tracker);
const spawnId = await createSpawn(tracker, taskId);
const spawn = await tracker.beads.show(trackerScope(tracker.repository, "worker"), spawnId);
const request = readSpawnRequest(spawn);
const record = transitionRequest(
	transitionRequest(newRequest(spawn, tracker.repository), { type: "READY" }),
	{ type: "START", id: "captured-attempt" },
);
const receipt: LaunchReceipt = {
	assignment: request.assignment,
	attemptNumber: 1,
	beadsDb: tracker.repository.beadsDb,
	bucket: tracker.repository.root,
	createdAt: "2026-10-21T00:00:00.000Z",
	cwd: tracker.repository.root,
	directory: "/fixture/captured-attempt",
	formula: { argv: [], executable: "fixture", headless: [] },
	host: request.host,
	id: record.context.attemptId!,
	identity: request.identity,
	invocation: { argv: [], executable: "fixture" },
	policyRevisionId: null,
	recipe: request.recipe,
	spawnId,
	taskIds: request.taskIds,
	token: "captured-token",
};
const attempt: AttemptInventory = { id: receipt.id, receipt, spawnId, state: "running" };
const captured = { record, receipt };
const current = { record, attempt, execution: { kind: "live" } as const, finish: undefined };
const settling = transitionRequest(record, {
	type: "SETTLE",
	outcome: null,
	message: "Execution stopped with unfinished work",
});
const released = transitionRequest(settling, { type: "RELEASED" });
const retrying = transitionRequest(released, {
	type: "SETTLED",
	now: 0,
	maxRetries: 2,
	delay: 2,
});

// This pure composition seam consumes observations, not manufactured process-ownership authority.
test("an unchanged executing checkpoint and running receipt remain eligible after local recheck", () => {
	expect(runningPublicationStillCurrent(captured, structuredClone(current))).toBe(true);
});

test.each(["waiting", "claiming", "settling", "retrying", "terminal"] as const)(
	"a late %s checkpoint abandons the stdout cohort",
	(state) => {
		expect(
			runningPublicationStillCurrent(captured, { ...current, record: { ...record, state } }),
		).toBe(false);
	},
);

test.each(["starting", "exited", "failed"] as const)(
	"a late %s attempt abandons the stdout cohort",
	(state) => {
		expect(
			runningPublicationStillCurrent(captured, { ...current, attempt: { ...attempt, state } }),
		).toBe(false);
	},
);

test.each([{ outcome: "success" }, { outcome: "blocked", reason: "Needs caller" }] as const)(
	"a late $outcome finish report abandons the stdout cohort",
	(finish) => {
		expect(runningPublicationStillCurrent(captured, { ...current, finish })).toBe(false);
	},
);

test("an owned-process exit detected during collection abandons the stdout cohort", () => {
	expect(
		runningPublicationStillCurrent(captured, { ...current, execution: { kind: "stopped" } }),
	).toBe(false);
});

test.each([
	{ name: "missing checkpoint", record: undefined, attempt },
	{ name: "missing attempt", record, attempt: undefined },
	{
		name: "replacement checkpoint",
		record: { ...record, context: { ...record.context, attemptId: "replacement-attempt" } },
		attempt,
	},
	{ name: "replacement inventory", record, attempt: { ...attempt, id: "replacement-attempt" } },
])("$name cannot silently adopt a replacement", (changed) => {
	expect(runningPublicationStillCurrent(captured, { ...current, ...changed })).toBe(false);
});

test.each([
	{ token: "replacement-token" },
	{ directory: "/fixture/replacement" },
	{ host: "another-host" },
	{ identity: "another-bee" },
	{ assignment: { kind: "driver", runId: "another-run" } },
	{ taskIds: ["another-task"] },
] satisfies Partial<LaunchReceipt>[])("changed receipt %j cannot authorize stdout", (changed) => {
	expect(() =>
		runningPublicationStillCurrent(captured, {
			...current,
			attempt: { ...attempt, receipt: { ...receipt, ...changed } },
		}),
	).toThrow(Error);
});

test("serial settlement and retry checkpoints do not become a newly planned cohort", () => {
	expect(runningPublicationStillCurrent(captured, { ...current, record: settling })).toBe(false);
	expect(runningPublicationStillCurrent(captured, { ...current, record: retrying })).toBe(false);
});
