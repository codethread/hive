import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import type { Assessment } from "./postrun.ts";
import { Database } from "bun:sqlite";
import type { NurseRuntime } from "./nurse.ts";
import { activateNurse } from "./nurse.ts";
import { beesConfigSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture requests use the same host binding as native requests.
import { hostname } from "node:os";
import { openStore } from "./store.ts";
import { publishResponse } from "./response-store.ts";
import { trackerScope } from "./tracker.ts";

const FIXTURE_TIME = 1000;

export async function nurseFixture(
	state = "/fixture/state",
	store = openStore(state, new Database(":memory:")),
) {
	const tracker = memoryTracker();
	const parent = await createTask(tracker, { title: "Colony health" });
	const config = beesConfigSchema.parse({
		owner: "ct",
		humans: ["ct"],
		formulas: {},
		auto_nurse: { parent, kind: "nurse" },
	});
	const submissions: { runId: string; requestId: string }[] = [];
	let status = "active";
	const start = async ({ parent: auditId }: { parent: string }) => {
		const runId = await createTask(tracker, { parent: auditId });
		const requestId = await createSpawn(tracker, runId);
		const result = { runId, requestId };
		submissions.push(result);
		return result;
	};
	const runtime: NurseRuntime = {
		...tracker,
		store,
		config,
		state,
		host: hostname(),
		now: () => FIXTURE_TIME,
		nurse: {
			start,
			attach: ({ runId }) => start({ parent: runId }),
			show: () => Promise.resolve({ status }),
		},
	};
	const scope = trackerScope(tracker.repository, "fixture");
	return {
		...runtime,
		runtime,
		scope,
		parent,
		submissions,
		done: () => {
			status = "done";
		},
		activate: () => activateNurse(runtime),
	};
}

export function assessment(
	requestId: string,
	successful = true,
): Extract<Assessment, { phase: "finished" }> {
	const id = crypto.randomUUID();
	return {
		id,
		requestId,
		beadsDb: "/fixture/tracker.db",
		phase: "finished",
		queuedAt: 0,
		deadline: 2,
		startedAt: 1,
		launched: true,
		source: {
			brief: "",
			systemPrompt: "",
			outcome: "completed",
			tasks: [],
			unavailableTasks: [],
			omittedTasks: 0,
			attempts: [],
			limits: "bounded",
		},
		receipt: {
			assignment: { kind: "driver", runId: "source" },
			attemptNumber: 1,
			beadsDb: "/fixture/tracker.db",
			bucket: "/fixture",
			createdAt: "2026-10-18T00:00:00Z",
			cwd: "/fixture",
			directory: "/fixture/attempt",
			formula: { argv: [], executable: "fixture", headless: [] },
			host: hostname(),
			id,
			identity: "inspector",
			invocation: { argv: [], executable: "fixture" },
			// eslint-disable-next-line unicorn/no-null -- Auxiliary receipts have no task policy revision.
			policyRevisionId: null,
			recipe: {
				// eslint-disable-next-line unicorn/no-null -- Null selects the canonical execution directory.
				cwd: null,
				effort: "low",
				harness: "fixture",
				kind: "post-run-drone",
				model: "fixture",
				prompt: "",
				system_prompt: "",
			},
			spawnId: id,
			taskIds: [],
			token: id,
		},
		result: assessmentResult(successful),
	};
}

function assessmentResult(
	successful: boolean,
): Extract<Assessment, { phase: "finished" }>["result"] {
	if (successful) {
		return {
			kind: "completed",
			report: {
				heuristic: "welcoming_hive",
				summary: "Source inspected",
				findings: [],
				orientation: { kind: "unavailable", reason: "Not measured" },
				uncertainty: ["No causal conclusion"],
			},
		};
	}
	return { kind: "failed", reason: "missing_report", detail: "Inspector did not deliver" };
}

export function seedReports(fixture: Awaited<ReturnType<typeof nurseFixture>>, count: number) {
	const entries = Array.from({ length: count }, (_entry, index) =>
		assessment(`request-${index}-${crypto.randomUUID()}`),
	);
	for (const entry of entries) {
		fixture.store.saveAssessment(fixture.repository.root, entry);
	}
	return entries;
}

/** Publish valid delivery while leaving the coverage cursor uncommitted. */
export async function seal(fixture: Awaited<ReturnType<typeof nurseFixture>>) {
	const active = fixture.store.nurseCheckpoint(fixture.repository.root)!.active!;
	if (active.phase !== "submitted") {
		throw new Error("Expected submitted audit");
	}
	const scope = trackerScope(fixture.repository, "worker");
	const response = await publishResponse(
		{ beads: fixture.beads, scope },
		{
			taskId: active.runId,
			requestId: active.requestId,
			body: "Complete sourced audit with uncertainty",
		},
	);
	await fixture.beads.update(scope, [active.auditId], {
		notes: JSON.stringify({
			format: "colony-nurse-coverage",
			token: active.token,
			responseId: response.responseId,
			reports: active.reports.map(({ id }) => ({ id, kind: "reviewed" })),
			gaps: active.gaps,
			topics: [],
		}),
	});
	await fixture.beads.close(scope, active.runId, { reason: "fixture done" });
	await fixture.beads.close(scope, active.requestId, { reason: "completed" });
	fixture.done();
}
