/* eslint-disable unicorn/no-null -- Settlement intent preserves explicit replacement absence. */
import {
	BEE_ACKNOWLEDGMENT_PREFIX,
	WORKFLOW_SETTLEMENT_PREFIX,
	beesConfigSchema,
	nativeWorkflowState,
	readSpawnRequest,
	readSpawnRequestSummary,
	requestDisposition,
	requestNeedsAttention,
	requestResolution,
	workflowResolution,
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
	return {
		...tracker,
		loadBeesConfig: () => Promise.resolve({ config, warnings: [] }),
		workflows: {
			inspect: async (runId, endpoint) => {
				const run = await tracker.beads.show(
					trackerScope(tracker.repository, endpoint.actor),
					runId,
				);
				const lifecycle = nativeWorkflowState(run, { runId, scope: "run" });
				return {
					runId,
					nativeStatus: run.status,
					updatedAt: run.updated_at,
					publication: {
						checkpoint: "checkpoint",
						savedAt: "now",
						locked: false,
						settlement: "none",
					},
					lifecycle,
					resolution: workflowResolution(run, lifecycle),
				};
			},
		},
	};
}

// eslint-disable-next-line max-statements -- Measure the full native admission and duplicate refusal scenario.
test("#test-105 submission rejects human reservations and admits one open request per task", async () => {
	const admission = memoryTracker();
	const task = await createTask(admission);
	const reserved = await createTask(admission, { assignee: "ct" });

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

test.each(["driver", "stage"])(
	"%s submission captures its scope and enforces duplicate admission",
	// eslint-disable-next-line max-statements -- Measure scope capture and duplicate refusal from a fresh hierarchy.
	async (kind) => {
		const workflowTracker = memoryTracker();
		const run = await createTask(workflowTracker);
		const stage = await createTask(workflowTracker, { parent: run });
		let assignment: WorkflowAssignment = { kind: "driver", runId: run };
		let anchor = run;
		if (kind === "stage") {
			assignment = { kind, runId: run, stageId: stage };
			anchor = stage;
		}
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

test.each(["driver", "stage"] as const)(
	"#test-304 %s cancellation requires opt-in and retains native history on replacement and repetition",
	// eslint-disable-next-line max-statements -- Measure native history and replacement together.
	async (kind) => {
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

test.each([
	"closed-anchor",
	"human",
	"hitl",
	"open-request",
	"acknowledged",
	"ambiguous",
	"succeeded",
])(
	"#test-305 explicit cancellation resumption preserves %s refusal",
	// eslint-disable-next-line max-statements -- Measure the complete reserved-scope refusal.
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
		const { id } = created.request;
		const before = await tracker.beads.show(scope, id);
		await expect(
			retryRequest(id, { ...options, resumeCancelled: true }, commands(tracker)),
		).rejects.toBeInstanceOf(Error);
		const after = await tracker.beads.show(scope, id);
		expect(after.dependents).toEqual(before.dependents);
	},
);

test.each(["driver", "stage"])(
	"%s retry retains its existing anchor with current execution defaults",
	// Preserve request role and the containing work while recording replacement provenance.
	// eslint-disable-next-line max-statements
	async (kind) => {
		const {
			workflowRetry,
			retryParent,
			retryRun,
			retryWorkIds,
			retryWorkBefore,
			assignment,
			anchor,
			oldId,
		} = await retryFixture(kind);
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

// Verify the retained replacement and unchanged predecessor after a partial write.
// eslint-disable-next-line max-statements
test.each(["exhausted", "Stopped by Bee"])(
	"retry retains %s replacement when predecessor label publication fails",
	// eslint-disable-next-line max-statements -- Measure the complete partial-publication and repeat-refusal scenario.
	async (reason) => {
		const retry = memoryTracker();
		const unfinished = await createTask(retry);
		const predecessorRequest = await spawnWorkflowRequest(
			{ kind: "worker", assignment: { kind: "driver", runId: unfinished }, options },
			commands(retry),
		);
		const predecessor = predecessorRequest.request.id;
		await retry.beads.close(trackerScope(retry.repository, "worker"), predecessor, {
			reason,
		});

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

test.each([
	{ locked: true, settlement: "none" as const },
	{ locked: false, settlement: "pending" as const },
])(
	"driver publication refuses lock $locked or intent $settlement before creating a request",
	async ({ locked, settlement }) => {
		const tracker = memoryTracker();
		const runId = await createTask(tracker);
		const context = commands(tracker);
		const before = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), runId);
		const blocked = {
			...context,
			workflows: {
				inspect: async (id: string, endpoint: { repo: string; db: string; actor: string }) => {
					const observed = await context.workflows.inspect(id, endpoint);
					return { ...observed, publication: { ...observed.publication, locked, settlement } };
				},
			},
		};
		await expect(
			spawnWorkflowRequest(
				{ kind: "worker", assignment: { kind: "driver", runId }, options },
				blocked,
			),
		).rejects.toBeInstanceOf(Error);
		expect(await tracker.beads.show(trackerScope(tracker.repository, "inspector"), runId)).toEqual(
			before,
		);
		const listing = await tracker.beads.list(trackerScope(tracker.repository, "inspector"), {
			labels: ["system", "bee"],
			all: true,
			limit: 0,
		});
		expect(listing.issues).toEqual([]);
	},
);

test("stage publication refuses a native settlement intent without reading the publisher lock", async () => {
	const tracker = memoryTracker();
	const runId = await createTask(tracker);
	const stageId = await createTask(tracker, { parent: runId });
	const scope = trackerScope(tracker.repository, "publisher");
	await tracker.beads.update(scope, [runId], {
		notes:
			WORKFLOW_SETTLEMENT_PREFIX +
			JSON.stringify({
				owner: "publisher",
				runId,
				operation: "cancel",
				reason: "Withdrawn",
				replacementId: null,
				inventory: [],
			}),
	});
	await expect(
		spawnWorkflowRequest(
			{ kind: "worker", assignment: { kind: "stage", runId, stageId }, options },
			{
				...commands(tracker),
				workflows: { inspect: () => Promise.reject(new Error("Stage publication owns its lock")) },
			},
		),
	).rejects.toBeInstanceOf(Error);
	const listing = await tracker.beads.list(scope, {
		labels: ["system", "bee"],
		all: true,
		limit: 0,
	});
	expect(listing.issues).toEqual([]);
});

/* eslint-disable-next-line max-statements --
 * Construct the complete predecessor and surrounding retained native hierarchy.
 */
async function retryFixture(kind: string) {
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

	let assignment: WorkflowAssignment = { kind: "driver", runId: retryRun };
	let anchor = retryRun;
	if (kind === "stage") {
		assignment = { kind, runId: retryRun, stageId: retryStage };
		anchor = retryStage;
	}
	const created = await spawnWorkflowRequest(
		{ kind: "worker", assignment, options },
		commands(workflowRetry),
	);
	await workflowRetry.beads.close(
		trackerScope(workflowRetry.repository, "worker"),
		created.request.id,
		{ reason: "blocked" },
	);
	return {
		workflowRetry,
		retryParent,
		retryRun,
		retryWorkIds,
		retryWorkBefore,
		assignment,
		anchor,
		oldId: created.request.id,
	};
}
