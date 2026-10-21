/* eslint-disable max-statements -- Verify admission, drain and request-attributed history as one operation. */
/* eslint-disable import/max-dependencies -- Compose the existing memory tracker, store and publication boundaries. */
/* eslint-disable unicorn/no-null -- Receipt and checkpoint fields explicitly preserve absence. */
import {
	RunningStdoutPublicationError,
	publishObservation,
	publishRunningStdoutActivities,
} from "./observations.ts";
import { afterAll, expect, test } from "bun:test";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Create and clean up the disposable store outside test timing.
import { mkdtemp, rm } from "node:fs/promises";
import { newRequest, publishRunningCohortWithHistory, transitionRequest } from "./request.ts";
import type { LaunchReceipt } from "./launch.ts";
import type { OperationEvidence } from "./history.ts";
import type { Store } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Locate disposable fixture artifacts.
import { join } from "node:path";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Let continuations run before asserting that a sibling still blocks completion.
 */
import { setImmediate as nextTurn } from "node:timers/promises";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Never write real attempt directories.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const state = await mkdtemp(join(tmpdir(), "colony-publication-history-"));
const store = openStore(state);
const config = beesConfigSchema.parse({ formulas: {}, humans: ["ct"], owner: "ct" });
const publishMemoryStdout: typeof publishRunningStdoutActivities = (context, inputs) =>
	publishRunningStdoutActivities(context, inputs, () => Promise.resolve(null));
const drain = await historyFixture();
const draining = drainingFixture(drain);
const setupFailure = await historyFixture();
const secondaryFailure = await historyFixture();
const warm = await historyFixture();
await publishRunningCohortWithHistory(warm.runtime, warm.inputs, publishMemoryStdout);
const warmFailure = await historyFixture();
await captureFailure(
	publishRunningCohortWithHistory(
		{
			...warmFailure.runtime,
			beads: {
				...warmFailure.runtime.beads,
				comments: {
					...warmFailure.runtime.beads.comments,
					add: () => Promise.reject(new Error("Warmup failure")),
				},
			},
		},
		warmFailure.inputs,
		publishMemoryStdout,
	),
);
const warmDrainFixture = await historyFixture();
const warmDraining = drainingFixture(warmDrainFixture);
const warmDrainOperation = captureFailure(
	publishRunningCohortWithHistory(
		warmDraining.runtime,
		warmDrainFixture.inputs,
		publishMemoryStdout,
	),
);
await warmDraining.allStarted.promise;
warmDraining.controls[ZERO]!.reject(warmDraining.failure);
await nextTurn();
warmDraining.controls[ONE]!.resolve();
await warmDrainOperation;
afterAll(async () => {
	store.close();
	await rm(state, { force: true, recursive: true });
});

test("request history and reconciliation stay pending until every admitted native comment settles", async () => {
	const { controls, allStarted, started, failure, runtime } = draining;
	let finished = false;
	const operation = (async () => {
		try {
			return await captureFailure(
				publishRunningCohortWithHistory(runtime, drain.inputs, publishMemoryStdout),
			);
		} finally {
			finished = true;
		}
	})();
	await allStarted.promise;
	expect(started).toEqual(drain.inputs.map(({ record }) => record.id));
	expect(drain.events.map(({ finished: done }) => done)).toEqual([false, false]);
	controls[ZERO]!.reject(failure);
	await nextTurn();
	expect(finished).toBe(false);
	expect(drain.events.map(({ finished: done }) => done)).toEqual([false, false]);
	controls[ONE]!.resolve();
	const error = await operation;
	expect(error).toBeInstanceOf(RunningStdoutPublicationError);
	expect(drain.events).toEqual([
		{
			id: started[ZERO]!,
			step: "observations.publish-running-stdout",
			finished: true,
			failures: [failure],
			confirmed: [],
		},
		{
			id: started[ONE]!,
			step: "observations.publish-running-stdout",
			finished: true,
			failures: [],
			confirmed: [],
		},
	]);
	expect(drain.trace.slice(ZERO, started.length)).toEqual(started.map((id) => `history:${id}`));
	expect(drain.trace.slice(started.length)).toEqual(["gate", `add:${started[ONE]}`]);
});

test("a history setup failure prevents the native gate and drains already-started histories", async () => {
	const failure = new Error("Cannot record attempted publication");
	const original = setupFailure.runtime.store.history.run;
	let index = ZERO;
	const runtime = {
		...setupFailure.runtime,
		store: {
			...setupFailure.runtime.store,
			history: {
				run: ((input, action) => {
					index += ONE;
					if (index === ONE) {
						return Promise.reject(failure);
					}
					return original(input, action);
				}) satisfies Store["history"]["run"],
			},
		},
	};
	expect(
		await captureFailure(
			publishRunningCohortWithHistory(runtime, setupFailure.inputs, publishMemoryStdout),
		),
	).toBe(failure);
	expect(setupFailure.trace).toEqual([`history:${setupFailure.inputs[ONE]!.record.id}`]);
	expect(setupFailure.events).toMatchObject([
		{ finished: true, failures: [failure], confirmed: [] },
	]);
});

test("history failure after native failure retains both causes and the secondary request identity", async () => {
	const nativeFailure = new Error("Native comment failed");
	const historyFailure = new Error("Cannot persist failed history");
	const original = secondaryFailure.runtime.store.history.run;
	const runtime = {
		...secondaryFailure.runtime,
		beads: {
			...secondaryFailure.runtime.beads,
			comments: {
				...secondaryFailure.runtime.beads.comments,
				add: () => Promise.reject(nativeFailure),
			},
		},
		store: {
			...secondaryFailure.runtime.store,
			history: {
				run: (async (input, action) => {
					try {
						return await original(input, action);
					} catch {
						throw historyFailure;
					}
				}) satisfies Store["history"]["run"],
			},
		},
	};
	const error = await captureFailure(
		publishRunningCohortWithHistory(runtime, secondaryFailure.inputs, publishMemoryStdout),
	);
	expect(error).toBeInstanceOf(AggregateError);
	const errors = (error as AggregateError).errors as Error[];
	expect(errors[ZERO]).toBeInstanceOf(RunningStdoutPublicationError);
	expect((errors[ZERO] as RunningStdoutPublicationError).failures).toEqual(
		secondaryFailure.inputs.map(({ record }) => ({ requestId: record.id, error: nativeFailure })),
	);
	expect(errors.slice(ONE).map(({ cause }) => cause)).toEqual([historyFailure, historyFailure]);
	expect(errors.slice(ONE).map(({ message }) => message)).toEqual(
		secondaryFailure.inputs.map(
			({ record }) => `Request ${record.id} stdout publication history failed`,
		),
	);
});

// --- Fixtures ---
async function historyFixture() {
	const tracker = memoryTracker();
	const inputs = await Promise.all(
		[ZERO, ONE].map(async (index) => {
			const taskId = await createTask(tracker);
			const id = await createSpawn(tracker, taskId);
			const scope = trackerScope(tracker.repository, "worker");
			await publishObservation(tracker, id, "running: attempt 1");
			const snapshot = await tracker.beads.show(scope, id);
			const request = readSpawnRequest(snapshot);
			const record = transitionRequest(
				transitionRequest(newRequest(snapshot, tracker.repository), { type: "READY" }),
				{ type: "START", id: `attempt-${index}` },
			);
			const receipt: LaunchReceipt = {
				assignment: request.assignment,
				attemptNumber: ONE,
				beadsDb: tracker.repository.beadsDb,
				bucket: tracker.repository.root,
				createdAt: "2026-10-21T00:00:00.000Z",
				cwd: tracker.repository.root,
				directory: state,
				formula: { argv: [], executable: "fixture", headless: [] },
				host: request.host,
				id: record.context.attemptId!,
				identity: request.identity,
				invocation: { argv: [], executable: "fixture" },
				policyRevisionId: null,
				recipe: request.recipe,
				spawnId: id,
				taskIds: request.taskIds,
				token: "fixture",
			};
			return { receipt, record, snapshot };
		}),
	);
	const events: {
		id: string | null;
		step: string;
		finished: boolean;
		failures: unknown[];
		confirmed: string[];
	}[] = [];
	const trace: string[] = [];
	const history: Store["history"] = {
		run: async (input, action) => {
			const event = {
				id: input.requestId,
				step: "",
				finished: false,
				failures: [] as unknown[],
				confirmed: [] as string[],
			};
			events.push(event);
			trace.push(`history:${input.requestId}`);
			const evidence: OperationEvidence = {
				step: (operation) => {
					event.step = operation;
				},
				reference: () => {},
				completed: (operation) => {
					event.confirmed.push(operation);
				},
				failed: (error) => {
					event.failures.push(error);
				},
			};
			try {
				return await action(evidence);
			} catch (error) {
				evidence.failed(error);
				throw error;
			} finally {
				event.finished = true;
			}
		},
	};
	const runtime = {
		...tracker,
		config,
		store: { ...store, history },
		beads: {
			...tracker.beads,
			showMany: (...args: Parameters<typeof tracker.beads.showMany>) => {
				trace.push("gate");
				return tracker.beads.showMany(...args);
			},
			comments: {
				...tracker.beads.comments,
				add: (...args: Parameters<typeof tracker.beads.comments.add>) => {
					trace.push(`add:${args[ONE]}`);
					return tracker.beads.comments.add(...args);
				},
			},
		},
	};
	return { runtime, inputs, events, trace };
}

async function captureFailure(operation: Promise<void>): Promise<unknown> {
	try {
		await operation;
	} catch (error) {
		return error;
	}
	return undefined;
}

function drainingFixture(fixture: Awaited<ReturnType<typeof historyFixture>>) {
	const controls = fixture.inputs.map(() => Promise.withResolvers<void>());
	const allStarted = Promise.withResolvers<void>();
	const started: string[] = [];
	const failure = new Error("Uncertain native commitment");
	const runtime = {
		...fixture.runtime,
		beads: {
			...fixture.runtime.beads,
			comments: {
				...fixture.runtime.beads.comments,
				add: async (...args: Parameters<typeof fixture.runtime.beads.comments.add>) => {
					const index = started.length;
					started.push(args[ONE]);
					if (started.length === fixture.inputs.length) {
						allStarted.resolve();
					}
					await controls[index]!.promise;
					return fixture.runtime.beads.comments.add(...args);
				},
			},
		},
	};
	return { controls, allStarted, started, failure, runtime };
}
