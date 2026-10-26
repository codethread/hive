/* eslint-disable max-statements -- Verify admission, drain and request-attributed history as one operation. */
/* eslint-disable import/max-dependencies -- Compose publication and history coordination with typed local fakes. */
/* eslint-disable unicorn/no-null -- Recipe, stdout and history values explicitly preserve absence. */
import { COLONY_OBSERVATION_PREFIX, spawnRequestLabels } from "@hive/shared";
import { RunningStdoutPublicationError, publishRunningStdoutActivities } from "./observations.ts";
import { expect, test } from "bun:test";
import type { BeadRecord } from "@hive/beads";
import type { OperationEvidence } from "./history.ts";
import type { Recipe } from "@hive/shared";
import type { RunningObservationInput } from "./observations.ts";
import type { Store } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Bind fixture authority to the native publication host.
import { hostname } from "node:os";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Let continuations run before asserting that a sibling still blocks completion.
 */
import { setImmediate as nextTurn } from "node:timers/promises";
import { publishRunningCohortWithHistory } from "./request.ts";

const ZERO = 0;
const ONE = 1;
const state = "/fixture/publication-history";
const recipe: Recipe = {
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Complete assigned tasks",
	system_prompt: "Worker role",
};
const publishMemoryStdout: typeof publishRunningStdoutActivities = (context, inputs) =>
	publishRunningStdoutActivities(context, inputs, () => Promise.resolve(null));

test("request history and reconciliation wait for every admitted native comment to settle #test-697", async () => {
	const drain = historyFixture();
	const draining = drainingFixture(drain);
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
	const setupFailure = historyFixture();
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

test(
	"history failure after native failure retains both causes " +
		"and the secondary request identity #test-727",
	async () => {
		const secondaryFailure = historyFixture();
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
	},
);

// --- Fixtures ---
function historyFixture() {
	const repository = { root: "/fixture", beadsDb: "/fixture/tracker.db" };
	const timestamp = "2026-10-21T00:00:00.000Z";
	const inputs = [ZERO, ONE].map((index) => {
		const taskId = `task-${index}`;
		const request = {
			assignment: { kind: "driver" as const, runId: taskId },
			host: hostname(),
			identity: "worker",
		};
		const id = `request-${index}`;
		const snapshot: BeadRecord = {
			title: "Running request",
			issue_type: "task",
			notes: "",
			design: "",
			acceptance_criteria: "",
			id,
			assignee: request.identity,
			owner: "ct",
			status: "open",
			priority: ONE,
			description: JSON.stringify({
				...recipe,
				assignment: request.assignment,
				host: request.host,
			}),
			labels: spawnRequestLabels("worker"),
			created_at: timestamp,
			updated_at: timestamp,
			dependencies: [
				{ dependency_type: "related", id: taskId, title: "Work", status: "open", priority: ONE },
			],
			dependents: [],
			comments: [
				{
					id: ONE,
					issue_id: id,
					author: "sys-colony",
					created_at: timestamp,
					text: `${COLONY_OBSERVATION_PREFIX} running: attempt 1`,
				},
			],
		};
		const record = { id };
		const receipt: RunningObservationInput["receipt"] = {
			attemptNumber: ONE,
			directory: state,
			id: `attempt-${index}`,
			spawnId: id,
		};
		return { receipt, record, snapshot };
	});
	const snapshots = new Map(inputs.map(({ snapshot }) => [snapshot.id, structuredClone(snapshot)]));
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
	const runtime: Parameters<typeof publishRunningCohortWithHistory>[typeof ZERO] = {
		repository,
		store: {
			history,
			// The history fake exercises coordination without sampling durable checkpoints.
			request: () => {
				throw new Error("Publication fixture unexpectedly read a durable checkpoint");
			},
		},
		beads: {
			showMany: (_scope, ids) => {
				trace.push("gate");
				return Promise.resolve(ids.map((id) => structuredClone(snapshots.get(id)!)));
			},
			comments: {
				add: (scope, id, text) => {
					trace.push(`add:${id}`);
					const snapshot = snapshots.get(id)!;
					const comment = {
						id: snapshot.comments.length + ONE,
						issue_id: id,
						author: scope.actor!,
						created_at: timestamp,
						text,
					};
					snapshot.comments.push(comment);
					return Promise.resolve({ ...comment });
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
