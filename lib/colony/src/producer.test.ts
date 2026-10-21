import {
	beesConfigSchema,
	readSpawnRequest,
	readSpawnRequestSummary,
	requestResolution,
} from "@hive/shared";
import { beforeTrackerWrite, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { retryRequest, spawnWorkflowRequest } from "./producer.ts";
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

const partialRetries = await Promise.all(
	["exhausted", "Stopped by Bee"].map(async (reason) => {
		const retry = memoryTracker();
		const unfinished = await workflowRun(retry);
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

const workflowTracker = memoryTracker();
const run = await workflowRun(workflowTracker);
const cases: { assignment: WorkflowAssignment; anchor: string }[] = [
	{ assignment: { kind: "driver", runId: run }, anchor: run },
];

test.each(cases)(
	"$assignment.kind submission captures its scope and enforces duplicate admission #test-556",
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
const retryRun = await workflowRun(workflowRetry, { parent: retryParent });
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
const retryCases = await Promise.all(
	[
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

const retryWorkBefore = await workflowRetry.beads.showMany(
	trackerScope(workflowRetry.repository, "inspector"),
	retryWorkIds,
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

async function workflowRun(
	tracker: ReturnType<typeof memoryTracker>,
	input: { parent?: string } = {},
) {
	const id = await createTask(tracker, input);
	const checkpoint = await createTask(tracker, {
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify({ formatVersion: 1, id, managedExecution: "managed" }),
	});
	await tracker.beads.dep.add(
		trackerScope(tracker.repository, "fixture"),
		id,
		checkpoint,
		"related",
	);
	return id;
}
