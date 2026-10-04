/* eslint-disable unicorn/no-null -- Fixtures exercise explicit unknown output and pending decisions. */
import {
	DRONE_RUNTIME_MS,
	INACTIVITY_INTERVAL_MS,
	assertVerdictAuthority,
	inactivityReviewDue,
} from "./drone.ts";
import { expect, test } from "bun:test";
import type { DroneReview } from "./drone.ts";
import type { LaunchReceipt } from "./launch.ts";
import type { RequestRecord } from "./request.ts";

const START = Date.parse("2026-10-04T10:00:00.000Z");
const BEFORE = 1;
const FIVE_MINUTES_MS = 300_000;
const receipt: LaunchReceipt = {
	attemptNumber: 1,
	beadsDb: "/tracker.db",
	bucket: "/repo",
	createdAt: new Date(START).toISOString(),
	cwd: "/repo",
	directory: "/state/review",
	formula: { argv: [], executable: "fixture" },
	id: "00000000-0000-4000-8000-000000000001",
	identity: "drone-fixture",
	invocation: { argv: [], executable: "fixture" },
	policyRevisionId: null,
	recipe: {
		cwd: "/repo",
		effort: "low",
		harness: "fixture",
		kind: "inspector",
		model: "configured",
		prompt: "inspect",
	},
	spawnId: "spawn",
	taskIds: [],
	token: "00000000-0000-4000-8000-000000000002",
};
const review: Extract<DroneReview, { phase: "reviewing" }> = {
	deadline: START + DRONE_RUNTIME_MS,
	decision: null,
	id: receipt.id,
	launched: true,
	phase: "reviewing",
	receipt,
	spawnId: "spawn",
	startedAt: START,
	targetAttemptId: "target-attempt",
};
const active: DroneReview = {
	...review,
	decision: { at: START + INACTIVITY_INTERVAL_MS, detail: "legitimate wait", kind: "active" },
	phase: "finished",
};
const request: RequestRecord = {
	beadsDb: receipt.beadsDb,
	context: {
		attemptId: review.targetAttemptId,
		attempts: 1,
		claims: ["task"],
		identity: "worker",
		message: "",
		outcome: null,
		pendingClaim: null,
		retryAt: null,
		taskIds: ["task"],
	},
	id: review.spawnId,
	state: "executing",
};
const verdict = {
	attemptId: receipt.id,
	reportedAt: START,
	reviewId: review.id,
	spawnId: review.spawnId,
	targetAttemptId: review.targetAttemptId,
	token: receipt.token,
	verdict: "active" as const,
};

test.each([
	{
		due: false,
		lastOutputAt: null,
		now: START + INACTIVITY_INTERVAL_MS - BEFORE,
		previous: undefined,
	},
	{ due: true, lastOutputAt: null, now: START + INACTIVITY_INTERVAL_MS, previous: undefined },
	{
		due: false,
		lastOutputAt: new Date(START + BEFORE).toISOString(),
		now: START + INACTIVITY_INTERVAL_MS,
		previous: undefined,
	},
	{ due: false, lastOutputAt: null, now: START + INACTIVITY_INTERVAL_MS, previous: review },
	{
		due: false,
		lastOutputAt: null,
		now: active.decision!.at + INACTIVITY_INTERVAL_MS - BEFORE,
		previous: active,
	},
	{
		due: true,
		lastOutputAt: null,
		now: active.decision!.at + INACTIVITY_INTERVAL_MS,
		previous: active,
	},
	{
		due: false,
		lastOutputAt: new Date(active.decision!.at + BEFORE).toISOString(),
		now: active.decision!.at + INACTIVITY_INTERVAL_MS,
		previous: active,
	},
	{
		due: false,
		lastOutputAt: null,
		now: START + INACTIVITY_INTERVAL_MS,
		previous: {
			...active,
			decision: { at: START, detail: "failed", kind: "launch_failed" as const },
		},
	},
])("inactivity trigger and deferral at $now, due=$due", ({ due, lastOutputAt, now, previous }) => {
	expect(inactivityReviewDue({ lastOutputAt, now, previous, startedAt: START })).toBe(due);
});

test("current review accepts only timely exact-attempt provenance", () => {
	expect(() => assertVerdictAuthority(verdict, { now: START, request, review })).not.toThrow();
	expect(DRONE_RUNTIME_MS).toBe(FIVE_MINUTES_MS);
});

test.each([
	{ field: "attemptId", value: "replacement-drone" },
	{ field: "reviewId", value: "older-review" },
	{ field: "spawnId", value: "replacement-spawn" },
	{ field: "targetAttemptId", value: "replacement-attempt" },
	{ field: "token", value: "other-token" },
	{ field: "reportedAt", value: review.deadline },
	{ field: "reportedAt", value: review.startedAt - BEFORE },
])("rejects verdict with wrong $field", ({ field, value }) => {
	expect(() =>
		assertVerdictAuthority({ ...verdict, [field]: value }, { now: START, request, review }),
	).toThrow(Error);
});

test("deadline, target replacement, settlement and decided reviews reject reports", () => {
	expect(() => assertVerdictAuthority(verdict, { now: review.deadline, request, review })).toThrow(
		Error,
	);
	expect(() =>
		assertVerdictAuthority(verdict, {
			now: START,
			request: { ...request, context: { ...request.context, attemptId: "replacement" } },
			review,
		}),
	).toThrow(Error);
	expect(() =>
		assertVerdictAuthority(verdict, {
			now: START,
			request: { ...request, state: "settling" },
			review,
		}),
	).toThrow(Error);
	expect(() => assertVerdictAuthority(verdict, { now: START, request, review: active })).toThrow(
		Error,
	);
});
