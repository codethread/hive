/* eslint-disable unicorn/no-null -- Checkpoints and events encode absent values as null. */
import type { RepositoryEndpoint, SpawnRequest } from "@hive/shared";
import type { RequestEvent, RequestRecord } from "./request.ts";
import {
	assertRequestAuthority,
	newRequest,
	requestRecordSchema,
	transitionRequest,
} from "./request.ts";
import { expect, test } from "bun:test";
import type { Bead } from "@hive/beads";

const RETRY_START = 0;
const events: RequestEvent[] = [
	{ type: "READY" },
	{ type: "INTEND", id: "run-1" },
	{ type: "ACQUIRED", id: "run-1" },
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
const captured: Pick<SpawnRequest, "assignment" | "identity" | "taskIds" | "host"> = {
	assignment: { kind: "driver", runId: "run-1" },
	host: "requesting-machine",
	identity: "friendly-bee",
	taskIds: ["run-1"],
};
const checkpoints: {
	state: RequestRecord["state"];
	attemptId: string | null;
	claims: string[];
	retryAt: number | null;
	event: RequestEvent;
	expectedState: RequestRecord["state"];
}[] = [
	{
		state: "executing",
		attemptId: "attempt",
		claims: ["run-1"],
		retryAt: null,
		event: { type: "SETTLE", outcome: null, message: "Retry unfinished work" },
		expectedState: "settling",
	},
	{
		state: "retrying",
		attemptId: null,
		claims: [],
		retryAt: 2,
		event: { type: "TICK", now: 2 },
		expectedState: "waiting",
	},
];

test("captured driver authority survives retries #test-476", () => {
	let record = driverRecord();
	expect(record.assignment).toEqual(captured.assignment);
	for (const event of events) {
		record = transitionRequest(record, event);
		expect(record.assignment).toEqual(captured.assignment);
		assertRequestAuthority(record, captured);
		if (event.type === "SETTLED" && event.now === RETRY_START) {
			expect(record).toMatchObject({ state: "retrying", context: { retryAt: 2 } });
		}
	}
	expect(record).toMatchObject({
		state: "terminal",
		context: { attempts: 2, outcome: "completed" },
	});
});

test("newRequest captures spawn-bead authority and the selected database", () => {
	const repository: RepositoryEndpoint = {
		root: "/canonical",
		beadsDb: "/selected/tracker.db",
	};
	const spawn: Bead = {
		assignee: "captured-bee",
		comments: [],
		created_at: "2026-10-13T00:00:00.000Z",
		dependencies: [{ id: "captured-run", dependency_type: "related" }],
		dependents: [],
		description: JSON.stringify({
			assignment: { kind: "driver", runId: "captured-run" },
			cwd: "/execution",
			effort: "low",
			harness: "fixture",
			host: "captured-host",
			kind: "worker",
			model: "fixture",
			prompt: "captured direction",
			system_prompt: "captured role",
		}),
		id: "captured-request",
		labels: ["system", "bee", "agent:worker", "bee-outcome:pending", "bee-resolution:unresolved"],
		owner: "ct",
		priority: 2,
		status: "open",
		updated_at: "2026-10-13T00:00:00.000Z",
	};
	expect(newRequest(spawn, repository)).toEqual({
		assignment: { kind: "driver", runId: "captured-run" },
		beadsDb: "/selected/tracker.db",
		host: "captured-host",
		context: {
			attemptId: null,
			attempts: 0,
			claims: [],
			identity: "captured-bee",
			message: "",
			outcome: null,
			pendingClaim: null,
			retryAt: null,
			taskIds: ["captured-run"],
		},
		id: "captured-request",
		state: "waiting",
	});
});

// Sample JSON restoration separately from the typed lifecycle's per-transition authority checks.
test.each(checkpoints)(
	"JSON/schema restoration preserves $state checkpoints and their next transition",
	({ state, attemptId, claims, retryAt, event, expectedState }) => {
		const initial = driverRecord();
		const checkpoint: RequestRecord = {
			...initial,
			state,
			context: {
				...initial.context,
				attemptId,
				attempts: 1,
				claims: [...claims],
				message: "Retained progress",
				retryAt,
			},
		};
		const restored = restore(checkpoint);
		expect(restored).toEqual(checkpoint);
		assertRequestAuthority(restored, captured);
		const next = transitionRequest(restored, event);
		expect(next.state).toBe(expectedState);
		assertRequestAuthority(next, captured);
	},
);

test("restored stage authority rejects a changed identity", () => {
	const initial = driverRecord();
	const stage: RequestRecord = {
		...initial,
		assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" },
		context: { ...initial.context, taskIds: ["stage-1"] },
	};
	const authority: typeof captured = {
		assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" },
		host: "requesting-machine",
		identity: "friendly-bee",
		taskIds: ["stage-1"],
	};
	const restored = restore(stage);
	assertRequestAuthority(restored, authority);
	expect(() => assertRequestAuthority(restored, { ...authority, identity: "another-bee" })).toThrow(
		Error,
	);
});

// --- Fixtures ---
function driverRecord(): RequestRecord {
	return {
		assignment: { kind: "driver", runId: "run-1" },
		beadsDb: "/fixture/tracker.db",
		host: "requesting-machine",
		context: {
			attemptId: null,
			attempts: 0,
			claims: [],
			identity: "friendly-bee",
			message: "",
			outcome: null,
			pendingClaim: null,
			retryAt: null,
			taskIds: ["run-1"],
		},
		id: "request-1",
		state: "waiting",
	};
}

function restore(record: RequestRecord): RequestRecord {
	// eslint-disable-next-line unicorn/prefer-structured-clone -- Test the checkpoint JSON format.
	const parsed: unknown = JSON.parse(JSON.stringify(record));
	return requestRecordSchema.parse(parsed);
}
