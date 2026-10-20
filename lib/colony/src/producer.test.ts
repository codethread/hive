import {
	BEE_ACKNOWLEDGMENT_PREFIX,
	beesConfigSchema,
	readSpawnRequest,
	readSpawnRequestSummary,
	requestDisposition,
	requestNeedsAttention,
	requestResolution,
} from "@hive/shared";
import { beforeTrackerWrite, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { retryRequest, spawnWorkflowRequest, validateRequestedTasks } from "./producer.ts";
import type { ProducerCommands } from "./producer.ts";
import { RequestPublicationError } from "./requests.ts";
import type { WorkflowAssignment } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Captured request host is an observable execution authority.
import { hostname } from "node:os";
import { trackerScope } from "./tracker.ts";

const config = beesConfigSchema.parse({
	owner: "ct",
	humans: ["ct"],
	kinds: {
		worker: {
			description: "Implement tasks",
			harness: "fixture",
			model: "fixture",
			effort: "low",
			system_prompt: "Worker role",
		},
	},
	formulas: { fixture: { executable: "fixture", argv: ["{{prompt}}"] } },
});
const options = { actor: "submitter", beadsDb: "/fixture/tracker.db", repo: "/fixture" };

function commands(tracker: ReturnType<typeof memoryTracker>): ProducerCommands {
	return { ...tracker, loadBeesConfig: () => Promise.resolve({ config, warnings: [] }) };
}

const admission = memoryTracker();
const task = await createTask(admission);
const reserved = await createTask(admission, { assignee: "ct" });
const partialRetries = await Promise.all(
	["exhausted", "Stopped by Bee"].map(async (reason) => {
		const retry = memoryTracker();
		const unfinished = await createTask(retry);
		const created = await spawnWorkflowRequest(
			{ kind: "worker", assignment: { kind: "driver", runId: unfinished }, options },
			commands(retry),
		);
		await retry.beads.close(trackerScope(retry.repository, "worker"), created.request.id, {
			reason,
		});
		return { retry, unfinished, predecessor: created.request.id, reason };
	}),
);

test("submission rejects human reservations and admits one open request per task #test-412", async () => {
	const context = commands(admission);
	await expect(
		spawnWorkflowRequest(
			{ kind: "worker", assignment: { kind: "driver", runId: reserved }, options },
			context,
		),
	).rejects.toBeInstanceOf(Error);
	await expect(
		validateRequestedTasks({ requestedIds: [reserved], options }, context),
	).rejects.toBeInstanceOf(Error);
	const created = await spawnWorkflowRequest(
		{ kind: "worker", assignment: { kind: "driver", runId: task }, options },
		context,
	);
	const request = await admission.beads.show(
		trackerScope(admission.repository, "inspector"),
		created.request.id,
	);
	expect(request.owner).toBe("ct");
	expect(request.assignee).toBe(created.request.assignee);
	expect(request.dependencies.map(({ id, dependency_type }) => ({ id, dependency_type }))).toEqual([
		{ id: task, dependency_type: "related" },
	]);
	await expect(
		spawnWorkflowRequest(
			{ kind: "worker", assignment: { kind: "driver", runId: task }, options },
			context,
		),
	).rejects.toBeInstanceOf(Error);
	await expect(
		validateRequestedTasks({ requestedIds: [task], options }, context),
	).rejects.toBeInstanceOf(Error);
});

const workflowTracker = memoryTracker();
const run = await createTask(workflowTracker);
const stage = await createTask(workflowTracker, { parent: run });
const cases: { assignment: WorkflowAssignment; anchor: string }[] = [
	{ assignment: { kind: "driver", runId: run }, anchor: run },
	{ assignment: { kind: "stage", runId: run, stageId: stage }, anchor: stage },
];

test.each(cases)(
	"$assignment.kind submission captures its scope and enforces duplicate admission",
	async ({ assignment, anchor }) => {
		const context = commands(workflowTracker);
		const created = await spawnWorkflowRequest({ kind: "worker", assignment, options }, context);
		const scope = trackerScope(workflowTracker.repository, "inspector");
		const native = await workflowTracker.beads.show(scope, created.request.id);
		const request = readSpawnRequest(native);
		expect(request).toMatchObject({
			assignment,
			host: hostname(),
			identity: created.request.assignee,
			taskIds: [anchor],
			recipe: { model: "fixture", system_prompt: "Worker role" },
		});
		expect(readSpawnRequestSummary(native).assignment).toEqual(assignment);
		expect(native.owner).toBe("ct");
		expect(request.recipe).not.toHaveProperty("workflow");
		await expect(
			spawnWorkflowRequest({ kind: "worker", assignment, options }, context),
		).rejects.toBeInstanceOf(Error);
	},
);

const workflowRetry = memoryTracker();
const retryParent = await createTask(workflowRetry, { assignee: "ct", status: "in_progress" });
const retryRun = await createTask(workflowRetry, { parent: retryParent });
const retryStage = await createTask(workflowRetry, { parent: retryRun });
const retrySaved = await createTask(workflowRetry, {
	parent: retryRun,
	status: "closed",
});
await workflowRetry.beads.update(
	trackerScope(workflowRetry.repository, "inspector"),
	[retrySaved],
	{ notes: JSON.stringify({ choice: "next", data: { evidence: "saved" } }) },
);
const retrySibling = await createTask(workflowRetry, {
	parent: retryParent,
	assignee: "old-driver",
	status: "in_progress",
});
const retryWorkIds = [retryParent, retryRun, retryStage, retrySaved, retrySibling];
const retryWorkBefore = await workflowRetry.beads.showMany(
	trackerScope(workflowRetry.repository, "inspector"),
	retryWorkIds,
);
const retryCases = await Promise.all(
	[
		{ assignment: { kind: "driver", runId: retryRun } as const, anchor: retryRun },
		{
			assignment: { kind: "stage", runId: retryRun, stageId: retryStage } as const,
			anchor: retryStage,
		},
	].map(async ({ assignment, anchor }) => {
		const created = await spawnWorkflowRequest(
			{ kind: "worker", assignment, options },
			commands(workflowRetry),
		);
		await workflowRetry.beads.close(
			trackerScope(workflowRetry.repository, "worker"),
			created.request.id,
			{ reason: "blocked" },
		);
		return { assignment, anchor, predecessor: created.request.id };
	}),
);

const cancelled = await Promise.all(
	(["driver", "stage"] as const).map(async (kind) => {
		const tracker = memoryTracker();
		const runId = await createTask(tracker);
		let assignment: WorkflowAssignment = { kind: "driver", runId };
		if (kind === "stage") {
			assignment = { kind, runId, stageId: await createTask(tracker, { parent: runId }) };
		}
		const created = await spawnWorkflowRequest(
			{ kind: "worker", assignment, options },
			commands(tracker),
		);
		const scope = trackerScope(tracker.repository, "operator");
		await tracker.beads.close(scope, created.request.id, { reason: "Stopped by Bee" });
		const original = await tracker.beads.show(scope, created.request.id);
		return { kind, assignment, tracker, scope, original };
	}),
);

test.each(cancelled)(
	"$kind cancellation requires opt-in and retains native history on replacement and repetition #test-429",
	// Verify the public replacement and retained native facts as one recovery boundary.
	// eslint-disable-next-line max-statements
	async ({ assignment, tracker, scope, original }) => {
		const context = commands(tracker);
		await expect(retryRequest(original.id, options, context)).rejects.toBeInstanceOf(Error);
		const replacement = await retryRequest(
			original.id,
			{ ...options, resumeCancelled: true, model: "current-override" },
			context,
		);
		const request = readSpawnRequest(await tracker.beads.show(scope, replacement.request.id));
		expect(request).toMatchObject({
			assignment,
			host: hostname(),
			recipe: { model: "current-override" },
		});
		expect(request.identity).not.toBe(original.assignee);
		expect(request.taskIds).toEqual(readSpawnRequest(original).taskIds);
		const retained = await tracker.beads.show(scope, original.id);
		expect(retained).toMatchObject({
			status: "closed",
			close_reason: original.close_reason,
			closed_at: original.closed_at,
			assignee: original.assignee,
			description: original.description,
		});
		expect(requestDisposition(retained)).toEqual({ outcome: "cancelled", resolution: "resolved" });
		expect(requestNeedsAttention(retained)).toBe(false);
		expect(requestResolution(retained)).toEqual({
			kind: "superseded",
			replacementIds: [request.id],
		});
		await expect(
			retryRequest(original.id, { ...options, resumeCancelled: true }, context),
		).rejects.toBeInstanceOf(Error);
		const repeated = await tracker.beads.show(scope, original.id);
		expect(repeated.dependents).toEqual(retained.dependents);
	},
);

const refusals = await Promise.all(
	["closed-anchor", "human", "hitl", "open-request", "acknowledged", "ambiguous", "succeeded"].map(
		// Assemble each native refusal before timing the unchanged public retry boundary.
		// eslint-disable-next-line max-statements
		async (reason) => {
			const tracker = memoryTracker();
			const scope = trackerScope(tracker.repository, "operator");
			const runId = await createTask(tracker);
			const stageId = await createTask(tracker, { parent: runId });
			const assignment = { kind: "stage", runId, stageId } as const;
			const context = commands(tracker);
			const created = await spawnWorkflowRequest({ kind: "worker", assignment, options }, context);
			let closeReason = "cancelled";
			if (reason === "acknowledged") {
				closeReason = "blocked";
			} else if (reason === "succeeded") {
				closeReason = "completed";
			}
			await tracker.beads.close(scope, created.request.id, { reason: closeReason });
			if (reason === "closed-anchor") {
				await tracker.beads.close(scope, stageId);
			} else if (reason === "human") {
				await tracker.beads.update(scope, [stageId], { assignee: "ct" });
			} else if (reason === "hitl") {
				await tracker.beads.update(scope, [stageId], { addLabels: ["hitl"] });
			} else if (reason === "acknowledged") {
				const old = await tracker.beads.show(scope, created.request.id);
				await tracker.beads.comments.add(
					scope,
					old.id,
					`${BEE_ACKNOWLEDGMENT_PREFIX} ${JSON.stringify({ closedAt: old.closed_at, reason: "accepted" })}`,
				);
			} else if (reason === "open-request") {
				await spawnWorkflowRequest({ kind: "worker", assignment, options }, context);
			} else if (reason === "ambiguous") {
				await Promise.all(
					["First replacement", "Second replacement"].map((title) =>
						tracker.beads.create(scope, {
							title,
							owner: "ct",
							deps: [{ id: created.request.id, type: "supersedes" }],
						}),
					),
				);
			}
			return { reason, tracker, scope, id: created.request.id };
		},
	),
);

test.each(refusals)(
	"explicit cancellation resumption preserves $reason refusal #test-545",
	async ({ tracker, scope, id }) => {
		const before = await tracker.beads.show(scope, id);
		await expect(
			retryRequest(id, { ...options, resumeCancelled: true }, commands(tracker)),
		).rejects.toBeInstanceOf(Error);
		const after = await tracker.beads.show(scope, id);
		expect(after.dependents).toEqual(before.dependents);
	},
);

test.each(retryCases)(
	"$assignment.kind retry retains its existing anchor with current execution defaults #test-502",
	// Preserve request role and the containing work while recording replacement provenance.
	// eslint-disable-next-line max-statements
	async ({ assignment, anchor, predecessor: oldId }) => {
		const context = commands(workflowRetry);
		const replacement = await retryRequest(oldId, options, {
			...context,
			loadBeesConfig: () =>
				Promise.resolve({
					config: {
						...config,
						kinds: {
							worker: {
								...config.kinds["worker"]!,
								model: "current-model",
								workflow: "new-default",
							},
						},
					},
					warnings: [],
				}),
		});
		const retriedNative = await workflowRetry.beads.show(
			trackerScope(workflowRetry.repository, "inspector"),
			replacement.request.id,
		);
		const retried = readSpawnRequest(retriedNative);
		expect(retried).toMatchObject({
			assignment,
			taskIds: [anchor],
			recipe: { model: "current-model" },
		});
		expect(retried.recipe).not.toHaveProperty("workflow");
		expect(retriedNative.dependencies).toContainEqual(
			expect.objectContaining({ id: oldId, dependency_type: "supersedes" }),
		);
		const retained = await workflowRetry.beads.showMany(
			trackerScope(workflowRetry.repository, "inspector"),
			retryWorkIds,
		);
		const runRecord = retained.find((record) => record.id === retryRun)!;
		expect(
			retained.map(({ dependencies: _dependencies, dependents: _dependents, ...record }) => record),
		).toEqual(
			retryWorkBefore.map(
				({ dependencies: _dependencies, dependents: _dependents, ...record }) => record,
			),
		);
		expect(runRecord.dependencies).toContainEqual(
			expect.objectContaining({ id: retryParent, dependency_type: "parent-child" }),
		);
	},
);

test.each(partialRetries)(
	"retry retains $reason replacement when predecessor label publication fails #test-550",
	// Verify the retained replacement and unchanged predecessor after a partial write.
	// eslint-disable-next-line max-statements
	async ({ retry, predecessor, unfinished, reason }) => {
		const beads = beforeTrackerWrite(retry.beads, () => {
			throw new Error("publication unavailable");
		});
		const failure: unknown = await retryRequest(
			predecessor,
			{ ...options, resumeCancelled: true },
			commands({ ...retry, beads }),
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(RequestPublicationError);
		if (!(failure instanceof RequestPublicationError)) {
			throw new Error("Expected retained replacement evidence");
		}
		const [replacementId] = failure.replacementIds;
		const replacement = await retry.beads.show(
			trackerScope(retry.repository, "inspector"),
			replacementId!,
		);
		expect(
			replacement.dependencies.map(({ id, dependency_type }) => ({ id, dependency_type })),
		).toEqual([
			{ id: unfinished, dependency_type: "related" },
			{ id: predecessor, dependency_type: "supersedes" },
		]);
		expect(replacement.status).toBe("open");
		const original = await retry.beads.show(
			trackerScope(retry.repository, "inspector"),
			predecessor,
		);
		expect(original.close_reason).toBe(reason);
		await expect(
			retryRequest(predecessor, { ...options, resumeCancelled: true }, commands(retry)),
		).rejects.toBeInstanceOf(Error);
		const repeated = await retry.beads.show(
			trackerScope(retry.repository, "inspector"),
			predecessor,
		);
		expect(requestResolution(repeated)).toEqual({
			kind: "superseded",
			replacementIds: [replacementId!],
		});
	},
);
