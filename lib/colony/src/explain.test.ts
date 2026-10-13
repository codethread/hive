/* eslint-disable unicorn/no-null -- Fixtures preserve explicit absent diagnostic evidence. */
import type { Explanation, ExplanationIO } from "./explain.ts";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { explainConditions, explainRequest } from "./explain.ts";
import { DaemonUnavailableError } from "./client.ts";
import type { RequestDiagnostic } from "@hive/shared";
import { readSpawnRequest } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const EMPTY = 0;
const TWO = 2;
const OBSERVED = "2026-10-04T12:00:00.000Z";
const repository = { beadsDb: "/repo/beads.db", root: "/repo" };
const limits = { colony: 1, kind: 1, kinds: {}, worktree: 1 };
const tracker = memoryTracker();
const taskId = await createTask(tracker);
const requestId = await createSpawn(tracker, [taskId]);
const request = readSpawnRequest(
	await tracker.beads.show(trackerScope(tracker.repository, "fixture"), requestId),
);
const diagnostic: RequestDiagnostic = {
	attempts: [retainedAttempt("failed"), retainedAttempt("exited")],
	checkpoint: null,
	colony: {
		attempts: [{ id: "other-attempt", spawnId: "other", state: "running" }],
		intent: "awake",
		policy: { limits, ranking: "fifo" },
		registration: "durable",
		repository: tracker.repository,
		state: "awake",
	},
	kind: "request_diagnostic",
	observedAt: OBSERVED,
	repository: tracker.repository,
	reservations: [
		{
			id: "other-attempt",
			spawnId: "other",
			state: "running",
			bucket: tracker.repository.root,
			kind: "worker",
		},
	],
};
// Establish the prior sample before another request reserves capacity; the test observes the changed daemon evidence afresh.
const initial = await explainRequest(requestId, tracker, {
	bucket: () => Promise.resolve(tracker.repository.root),
	diagnose: () =>
		Promise.resolve({
			...diagnostic,
			attempts: [],
			colony: { ...diagnostic.colony!, attempts: [] },
			reservations: [],
		}),
	observe: unexpectedIO,
	source: "fixture daemon",
});

test("another request changes available capacity while every target terminal attempt stays observable", async () => {
	const reads: string[] = [];
	const io: ExplanationIO = {
		bucket: () => {
			reads.push("bucket");
			return Promise.resolve(tracker.repository.root);
		},
		diagnose: (id) => {
			reads.push(`diagnose:${id}`);
			return Promise.resolve(diagnostic);
		},
		observe: (id, attempt) => {
			reads.push(`observe:${id}:${attempt.id}`);
			return Promise.resolve("live");
		},
		source: "fixture daemon",
	};
	const result = await explainRequest(requestId, tracker, io);
	expect(initial.capacity.result).toMatchObject({ kind: "available", value: { available: true } });
	expect(reads).toEqual([
		`diagnose:${requestId}`,
		"bucket",
		`observe:${requestId}:failed`,
		`observe:${requestId}:exited`,
	]);
	expect(result.capacity.result).toMatchObject({
		kind: "available",
		value: { available: false, occupied: [{ bucket: tracker.repository.root, kind: "worker" }] },
	});
	expect(result.runtime.freshness).toBe("checkpoint_age_unknown");
	expect(result.processes.map(({ attemptId }) => attemptId)).toEqual(["failed", "exited"]);
	expect(result.diagnostics.filter(({ code }) => code === "attempt_process")).toHaveLength(TWO);
	expect(result.diagnostics.map(({ code }) => code)).toContain("capacity");
});

test.each([
	{ failure: "connection", reason: "daemon_unavailable" },
	{ failure: "authority", reason: "evidence_unavailable" },
])("$failure failure retains independent native evidence", async ({ failure, reason }) => {
	let error: Error = new Error("Different tracker");
	if (failure === "connection") {
		error = new DaemonUnavailableError("No daemon");
	}
	const result = await explainRequest(requestId, tracker, {
		bucket: unexpectedIO,
		observe: unexpectedIO,
		source: "fixture daemon",
		diagnose: () => Promise.reject(error),
	});
	expect(result.tracker.result.kind).toBe("available");
	expect(result.runtime.result).toMatchObject({ kind: "unavailable", reason });
	expect(result.capacity.result.kind).toBe("unavailable");
	expect(result.processes).toEqual([]);
});

test("tracker failure leaves retained and process evidence available with unknown capacity", async () => {
	const result = await explainRequest(
		requestId,
		{
			...tracker,
			beads: { ...tracker.beads, show: () => Promise.reject(new Error("Tracker unavailable")) },
		},
		{
			bucket: unexpectedIO,
			diagnose: () => Promise.resolve(diagnostic),
			observe: () => Promise.resolve("stopped"),
			source: "fixture daemon",
		},
	);
	expect(result.tracker.result.kind).toBe("unavailable");
	expect(result.runtime.result.kind).toBe("available");
	expect(result.capacity.result.kind).toBe("unavailable");
	expect(
		result.processes.every(({ evidence: process }) => process.result.kind === "available"),
	).toBe(true);
});

test.each([
	{ expected: "colony_asleep", state: "asleep" },
	{ expected: "colony_failed", state: "failed" },
	{ expected: "runnable", state: "awake" },
] as const)("explains $state without inventing a merged state", ({ state, expected }) => {
	const result = evidence();
	if (result.runtime.result.kind !== "available") {
		throw new Error("Expected runtime fixture");
	}
	result.runtime.result.value.colony = {
		attempts: [],
		intent: "awake",
		message: "Tracker read failed",
		policy: { limits, ranking: "fifo" },
		registration: "durable",
		repository,
		state,
	};
	const diagnostics = explainConditions(result);
	expect(diagnostics.map(({ code }) => code)).toContain(expected);
	expect(
		diagnostics.every((item) => item.nextTransition.length > EMPTY && item.evidence.length > EMPTY),
	).toBe(true);
});

test("claims and native dependency readiness stay distinct from available capacity", () => {
	const result = evidence();
	if (result.tracker.result.kind !== "available") {
		throw new Error("Expected tracker fixture");
	}
	result.tracker.result.value.eligibility = "waiting";
	result.tracker.result.value.tasks = [
		{
			assignee: "ct",
			dependencies: [
				{ dependency_type: "blocks", id: "dependency", status: "open", updatedAt: OBSERVED },
			],
			hitl: true,
			id: "task",
			ready: false,
			status: "open",
			updatedAt: OBSERVED,
		},
	];
	const diagnostics = explainConditions(result);
	expect(diagnostics.map(({ code }) => code)).toEqual(
		expect.arrayContaining(["claim", "native_readiness", "hitl", "eligibility"]),
	);
	expect(diagnostics.find(({ code }) => code === "native_readiness")?.message).toContain(
		"dependency (open)",
	);
	expect(diagnostics.some(({ code }) => code === "runnable")).toBe(false);
});

test("capacity and retry checkpoints state conditions rather than launch promises", () => {
	const result = evidence();
	if (result.capacity.result.kind !== "available" || result.runtime.result.kind !== "available") {
		throw new Error("Expected fixture");
	}
	result.capacity.result.value.available = false;
	result.capacity.result.value.occupied = [{ bucket: "/repo", kind: "worker" }];
	result.runtime.result.value.checkpoint = {
		attemptId: null,
		attempts: 1,
		id: "spawn",
		identity: "bee",
		message: "Retry scheduled",
		outcome: null,
		retryAt: 123,
		state: "retrying",
		taskIds: ["task"],
	};
	expect(explainConditions(result).map(({ code }) => code)).toEqual(
		expect.arrayContaining(["capacity", "retry"]),
	);
});

test.each([
	{ expected: "running_observed", observed: "live", recorded: "failed" },
	{ expected: "stopped_observed", observed: "stopped", recorded: "running" },
] as const)(
	"reports fresh $observed against stale $recorded without repairing evidence",
	// eslint-disable-next-line max-statements -- Compare immutable evidence with both contradictory diagnostic conclusions.
	({ observed, recorded, expected }) => {
		const result = evidence();
		if (result.runtime.result.kind !== "available" || result.tracker.result.kind !== "available") {
			throw new Error("Expected fixture");
		}
		result.tracker.result.value.status = "closed";
		result.tracker.result.value.disposition = { outcome: "failed", resolution: "unresolved" };
		result.runtime.result.value.attempts = [
			{
				attemptNumber: 1,
				bucket: "/repo",
				createdAt: OBSERVED,
				cwd: "/repo",
				harness: "fixture",
				id: "attempt",
				identity: "bee",
				kind: "worker",
				model: "fixture",
				paths: {
					receipt: "/receipt",
					stderr: "/stderr",
					stdout: "/stdout",
					supervisor: "/supervisor",
					worker: "/worker",
				},
				policyRevisionId: null,
				spawnId: "spawn",
				state: recorded,
				taskIds: ["task"],
			},
		];
		result.processes = [
			{
				attemptId: "attempt",
				evidence: {
					freshness: "sampled",
					observedAt: OBSERVED,
					result: { kind: "available", value: observed },
					source: "ownership",
				},
			},
		];
		const before = JSON.stringify(result);
		const diagnostics = explainConditions(result);
		expect(diagnostics.map(({ code }) => code)).toEqual(
			expect.arrayContaining([expected, "attempt_process", "request_closed", "failure_attention"]),
		);
		expect(diagnostics.some(({ code }) => code === "closed_live")).toBe(observed === "live");
		expect(JSON.stringify(result)).toBe(before);
	},
);

test("missing process and daemon evidence remains unknown", () => {
	const result = evidence();
	result.runtime.result = {
		kind: "unavailable",
		message: "No daemon",
		reason: "daemon_unavailable",
	};
	result.capacity.result = {
		kind: "unavailable",
		message: "No active policy",
		reason: "evidence_unavailable",
	};
	result.processes = [
		{
			attemptId: "attempt",
			evidence: {
				freshness: "sampled",
				observedAt: OBSERVED,
				result: { kind: "unavailable", message: "Token mismatch", reason: "evidence_unavailable" },
				source: "ownership",
			},
		},
	];
	const codes = explainConditions(result).map(({ code }) => code);
	expect(codes).toEqual(
		expect.arrayContaining(["runtime_unavailable", "capacity_unavailable", "process_unknown"]),
	);
	expect(codes).not.toContain("stopped_observed");
	expect(codes).not.toContain("runnable");
});

test("changed request authority stays explicit beside an executing checkpoint", () => {
	const result = evidence();
	if (result.runtime.result.kind !== "available" || result.tracker.result.kind !== "available") {
		throw new Error("Expected fixture");
	}
	result.runtime.result.value.checkpoint = {
		attemptId: "attempt",
		attempts: 1,
		id: "spawn",
		identity: "original-bee",
		message: "Executing",
		outcome: null,
		retryAt: null,
		state: "executing",
		taskIds: ["original-task"],
	};
	result.tracker.result.value.tasks = [
		{
			assignee: "ct",
			dependencies: [],
			hitl: false,
			id: "changed-task",
			ready: false,
			status: "in_progress",
			updatedAt: OBSERVED,
		},
	];
	expect(explainConditions(result).map(({ code }) => code)).toEqual(
		expect.arrayContaining(["request_authority", "execution_claim"]),
	);
});

test("closed tasks leave a live bee in control of its completion point", () => {
	const result = evidence();
	if (result.runtime.result.kind !== "available" || result.tracker.result.kind !== "available") {
		throw new Error("Expected fixture");
	}
	result.tracker.result.value.eligibility = "finished";
	result.runtime.result.value.checkpoint = {
		attemptId: "attempt",
		attempts: 1,
		id: "spawn",
		identity: "bee",
		message: "Executing",
		outcome: null,
		retryAt: null,
		state: "executing",
		taskIds: [],
	};
	expect(
		explainConditions(result).find(({ code }) => code === "tasks_finished")?.nextTransition,
	).toMatchInlineSnapshot(
		'"The bee retains its live execution for cleanup and reporting; a finish report or process exit allows Colony to settle it."',
	);
});

// --- Private functions ---
function unexpectedIO(): never {
	throw new Error("Unavailable evidence must not trigger dependent reads");
}

function retainedAttempt(state: "failed" | "exited"): RequestDiagnostic["attempts"][number] {
	return {
		attemptNumber: 1,
		bucket: tracker.repository.root,
		createdAt: OBSERVED,
		cwd: tracker.repository.root,
		harness: "fixture",
		id: state,
		identity: request.identity,
		kind: request.recipe.kind,
		model: "fixture",
		paths: {
			receipt: `/${state}/receipt`,
			stderr: "/stderr",
			stdout: "/stdout",
			supervisor: "/supervisor",
			worker: "/worker",
		},
		policyRevisionId: null,
		spawnId: request.id,
		state,
		taskIds: request.taskIds,
	};
}

function evidence(): Omit<Explanation, "diagnostics"> {
	return {
		capacity: {
			freshness: "checkpoint_age_unknown",
			observedAt: OBSERVED,
			result: {
				kind: "available",
				value: {
					available: true,
					candidate: { bucket: "/repo", kind: "worker" },
					limits,
					occupied: [],
				},
			},
			source: "dispatch",
		},
		id: "spawn",
		kind: "explanation",
		processes: [],
		repository,
		runtime: {
			freshness: "checkpoint_age_unknown",
			observedAt: OBSERVED,
			result: {
				kind: "available",
				value: {
					attempts: [],
					checkpoint: null,
					colony: {
						attempts: [],
						intent: "awake",
						policy: { limits, ranking: "fifo" },
						registration: "durable",
						repository,
						state: "awake",
					},
				},
			},
			source: "daemon",
		},
		tracker: {
			freshness: "sampled",
			observedAt: OBSERVED,
			result: {
				kind: "available",
				value: {
					closeReason: null,
					disposition: { outcome: "pending", resolution: "unresolved" },
					eligibility: "eligible",
					execution: { cwd: null, kind: "worker" },
					identity: "bee",
					labelPublication: "current",
					lastObservation: null,
					message: null,
					status: "open",
					tasks: [],
					updatedAt: OBSERVED,
				},
			},
			source: "native Beads",
		},
	};
}
