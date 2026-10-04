/* eslint-disable unicorn/no-null -- Durable JSON checkpoints explicitly preserve absent attempt, claim, deadline and outcome fields. */
import type { AttemptInventory, Store } from "./store.ts";
import type { Bead, BeesConfig, RepositoryEndpoint } from "@hive/shared";
import { acquireClaim, releaseClaims } from "./claims.ts";
import { assign, createActor, setup } from "xstate";
import {
	beads,
	readSpawnRequest,
	requestOutcomeSchema,
	requestStateSchema,
	showBead,
} from "@hive/shared";
import { cancelDroneReview, reviewInactivity } from "./drone.ts";
import { observeExecution, resumeExecution, stopExecution } from "./processes.ts";
import { publishObservation, publishStdoutActivity } from "./observations.ts";
import type { OperationEvidence } from "./history.ts";
import { publishRequestLabels } from "./requests.ts";
import { readFinishReport } from "./launch.ts";
// eslint-disable-next-line import/max-dependencies -- Request reconciliation composes claims, execution, drone review and operation evidence.
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const contextSchema = z.strictObject({
	attemptId: z.string().nullable(),
	attempts: z.number().int().nonnegative(),
	claims: z.array(z.string()),
	identity: z.string(),
	message: z.string(),
	outcome: requestOutcomeSchema.nullable(),
	pendingClaim: z.string().nullable(),
	retryAt: z.number().nullable(),
	taskIds: z.array(z.string()),
});
export const requestRecordSchema = z.strictObject({
	/** Selected tracker authority retained independently of membership and attempts. */
	beadsDb: z.string(),
	context: contextSchema,
	id: z.string(),
	state: requestStateSchema,
});
interface RequestRuntime {
	/** Canonical tracker authority for every claim and request effect. */
	repository: RepositoryEndpoint;
	/** Durable request and attempt checkpoints. */
	store: Store;
	/** Current canonical retry policy. */
	config: BeesConfig;
	/** Inactivity review clock; production uses the current wall clock. */
	now?: () => number;
}
export type RequestRecord = z.infer<typeof requestRecordSchema>;
type RequestContext = z.infer<typeof contextSchema>;
export type RequestEvent =
	| { type: "READY" }
	| { type: "WAIT"; message: string }
	| { type: "INTEND"; id: string }
	| { type: "ACQUIRED"; id: string }
	| { type: "SKIP" }
	| { type: "START"; id: string }
	| { type: "SETTLE"; outcome: RequestContext["outcome"]; message: string }
	| { type: "RELEASED" }
	| { type: "SETTLED"; now: number; maxRetries: number; delay: number }
	| { type: "TICK"; now: number };

const machine = setup({
	types: { context: {} as RequestContext, events: {} as RequestEvent },
}).createMachine({
	context: {
		attemptId: null,
		attempts: ZERO,
		claims: [],
		identity: "",
		message: "",
		outcome: null,
		pendingClaim: null,
		retryAt: null,
		taskIds: [],
	},
	initial: "waiting",
	states: {
		claiming: {
			on: {
				ACQUIRED: {
					actions: assign({
						claims: ({ context, event }) => [...context.claims, event.id],
						pendingClaim: null,
					}),
				},
				INTEND: { actions: assign({ pendingClaim: ({ event }) => event.id }) },
				SETTLE: {
					actions: assign({
						message: ({ event }) => event.message,
						outcome: ({ event }) => event.outcome,
						pendingClaim: null,
					}),
					target: "settling",
				},
				SKIP: { actions: assign({ pendingClaim: null }) },
				START: {
					actions: assign({
						attemptId: ({ event }) => event.id,
						attempts: ({ context }) => context.attempts + ONE,
					}),
					target: "executing",
				},
			},
		},
		executing: {
			on: {
				SETTLE: {
					actions: assign({
						message: ({ event }) => event.message,
						outcome: ({ event }) => event.outcome,
					}),
					target: "settling",
				},
			},
		},
		retrying: {
			on: {
				SETTLE: {
					actions: assign({
						message: ({ event }) => event.message,
						outcome: ({ event }) => event.outcome,
					}),
					target: "settling",
				},
				TICK: { guard: ({ context, event }) => event.now >= context.retryAt!, target: "waiting" },
			},
		},
		settling: {
			on: {
				RELEASED: { actions: assign({ claims: [], pendingClaim: null }) },
				SETTLED: [
					{
						actions: assign({ attemptId: null, retryAt: null }),
						guard: ({ context }) => context.outcome !== null,
						target: "terminal",
					},
					{
						actions: assign({ attemptId: null, outcome: "exhausted", retryAt: null }),
						guard: ({ context, event }) => context.attempts > event.maxRetries,
						target: "terminal",
					},
					{
						actions: assign({ attemptId: null, retryAt: ({ event }) => event.now + event.delay }),
						target: "retrying",
					},
				],
			},
		},
		terminal: { type: "final" },
		waiting: {
			on: {
				READY: { actions: assign({ message: "", retryAt: null }), target: "claiming" },
				SETTLE: {
					actions: assign({
						message: ({ event }) => event.message,
						outcome: ({ event }) => event.outcome,
					}),
					target: "settling",
				},
				WAIT: { actions: assign({ message: ({ event }) => event.message }) },
			},
		},
	},
});

/** A request keeps its captured identity and task relationships across every attempt. */
export function newRequest(spawn: Bead, repository: RepositoryEndpoint): RequestRecord {
	const request = readSpawnRequest(spawn);
	return {
		beadsDb: repository.beadsDb,
		context: {
			attemptId: null,
			attempts: ZERO,
			claims: [],
			identity: request.identity,
			message: "",
			outcome: null,
			pendingClaim: null,
			retryAt: null,
			taskIds: request.taskIds,
		},
		id: request.id,
		state: "waiting",
	};
}
/** XState alone selects lifecycle transitions; callers persist the result before effects. */
export function transitionRequest(record: RequestRecord, event: RequestEvent): RequestRecord {
	const snapshot = machine.resolveState({ context: record.context, value: record.state });
	const actor = createActor(machine, { snapshot });
	actor.start();
	actor.send(event);
	const next = actor.getSnapshot();
	actor.stop();
	return { ...record, context: next.context, state: next.value as RequestRecord["state"] };
}

/** External spawn edits cannot change the authority already used for claims and retries. */
export function assertRequestAuthority(
	record: RequestRecord,
	identity: string | undefined,
	taskIds: string[],
): void {
	if (
		identity !== record.context.identity ||
		taskIds.length !== record.context.taskIds.length ||
		!taskIds.every((id) => record.context.taskIds.includes(id))
	) {
		throw new Error(`Request ${record.id} changed its captured identity or related tasks`);
	}
}

/** Awake passes resume durable checkpoints before considering replacement launches. */
export async function reconcileRequests(runtime: RequestRuntime): Promise<void> {
	const { repository, store } = runtime;
	const inventory = await store.inventory(repository.root);
	for (const saved of store.requests(repository.root).filter(({ state }) => state !== "terminal")) {
		// eslint-disable-next-line no-await-in-loop -- Finish each request's external effects before advancing another durable checkpoint.
		await store.history.run(
			{
				checkpoint: () => store.requests(repository.root).find(({ id }) => id === saved.id),
				operation: "reconcile",
				repository,
				requestId: saved.id,
			},
			(evidence) => reconcileRequest(runtime, saved, inventory, evidence),
		);
	}
}

/** Acquire sequentially only after capacity is granted; each intent precedes its tracker write. */
// eslint-disable-next-line max-statements -- Claim checkpoints and partial-failure cleanup stay adjacent to their mutations.
export function claimRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
): Promise<RequestRecord | null> {
	const { repository, store } = runtime;
	return store.history.run(
		{
			checkpoint: () => store.requests(repository.root).find(({ id }) => id === saved.id),
			operation: "claim",
			repository,
			requestId: saved.id,
		},
		(evidence) => acquireRequest(runtime, saved, evidence),
	);
}

// eslint-disable-next-line max-statements -- Acquisition checkpoints and partial failure settlement remain ordered together.
async function acquireRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
	evidence: OperationEvidence,
): Promise<RequestRecord | null> {
	const { repository, store } = runtime;
	let record = store.advanceRequest(repository.root, saved, { type: "READY" });
	for (const id of record.context.taskIds) {
		record = store.advanceRequest(repository.root, record, { id, type: "INTEND" });
		// eslint-disable-next-line no-await-in-loop -- Persist each acquisition before the next task can be claimed.
		const outcome = await acquireClaim(repository, record.context.identity, id, evidence);
		if (outcome === "conflict") {
			record = store.advanceRequest(repository.root, record, {
				message: `Task ${id} changed reservation during acquisition`,
				outcome: "claim_failed",
				type: "SETTLE",
			});
			// eslint-disable-next-line no-await-in-loop -- No execution has launched; release only already recorded partial acquisitions.
			await finishSettlement(runtime, record, evidence);
			return null;
		}
		// eslint-disable-next-line unicorn/prefer-ternary -- Explicit machine events keep claim and closed-task paths visible.
		if (outcome === "claimed") {
			record = store.advanceRequest(repository.root, record, { id, type: "ACQUIRED" });
		} else {
			record = store.advanceRequest(repository.root, record, { type: "SKIP" });
		}
	}
	if (record.context.claims.length === ZERO) {
		record = store.advanceRequest(repository.root, record, {
			message: "All related tasks closed during acquisition",
			outcome: "completed",
			type: "SETTLE",
		});
		await finishSettlement(runtime, record, evidence);
		return null;
	}
	return record;
}

// --- Request effects ---
// eslint-disable-next-line max-statements, max-params -- Reconcile durable lifecycle state with current tracker and verified execution facts.
async function reconcileRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
	inventory: AttemptInventory[],
	evidence: OperationEvidence,
): Promise<void> {
	const { repository, store } = runtime;
	let record = saved;
	if (record.state === "claiming") {
		if (record.context.pendingClaim !== null) {
			throw new Error(
				`Request ${record.id} has ambiguous interrupted claim ${record.context.pendingClaim}`,
			);
		}
		record = store.advanceRequest(repository.root, record, {
			message: "Claim acquisition interrupted before launch",
			outcome: "claim_failed",
			type: "SETTLE",
		});
	}
	evidence.step("tracker.show", record.id);
	const spawn = await showBead(repository, record.context.identity, record.id);
	const request = readSpawnRequest(spawn);
	assertRequestAuthority(record, request.identity, request.taskIds);
	if (record.state !== "settling") {
		if (spawn.status === "closed") {
			record = store.advanceRequest(repository.root, record, {
				message: "Spawn request closed",
				outcome: "cancelled",
				type: "SETTLE",
			});
		} else if (record.state === "executing") {
			const attempt = inventory.find(({ id }) => id === record.context.attemptId)!;
			evidence.reference(attempt.receipt.directory);
			evidence.step("execution.resume", attempt.id);
			await resumeExecution(attempt.receipt, (supervisor) =>
				store.supervisor(attempt.id, supervisor.pid),
			);
			evidence.step("execution.observe", attempt.id);
			const observed = await observeExecution(attempt.receipt);
			const report = await readFinishReport(attempt.receipt);
			if (
				report ||
				attempt.state === "exited" ||
				attempt.state === "failed" ||
				observed.kind === "stopped"
			) {
				evidence.step("tracker.show-related", record.id);
				const tasks = await Promise.all(
					record.context.taskIds.map((id) => showBead(repository, record.context.identity, id)),
				);
				const unfinished = tasks.filter(({ status }) => status !== "closed");
				let outcome: RequestContext["outcome"] = null;
				let message = "Execution stopped with unfinished work";
				if (report?.outcome === "blocked") {
					outcome = "blocked";
					message = `Self-report blocked; attempt ${attempt.id}; unfinished tasks: ${unfinished.map(({ id }) => id).join(", ")}; reason: ${report.reason}`;
				} else if (unfinished.length === ZERO) {
					outcome = "completed";
					message = `Execution finished with all tasks closed; attempt ${attempt.id}`;
				} else if (report?.outcome === "success") {
					message = `Self-report success with unfinished work; attempt ${attempt.id}`;
				}
				record = store.advanceRequest(repository.root, record, {
					message,
					outcome,
					type: "SETTLE",
				});
			} else if (attempt.state === "running") {
				evidence.step("drone.review", attempt.id);
				record = await reviewRunningAttempt(runtime, record, attempt);
				evidence.step("stdout.publish", record.id);
				await publishStdoutActivity(repository, attempt.receipt);
				if (record.state === "executing") {
					evidence.step("observation.publish", record.id);
					await publishRunningObservation(runtime, record, attempt);
				}
			}
		} else {
			evidence.step("tracker.show-related", record.id);
			const tasks = await Promise.all(
				record.context.taskIds.map((id) => showBead(repository, record.context.identity, id)),
			);
			if (tasks.length > ZERO && tasks.every(({ status }) => status === "closed")) {
				record = store.advanceRequest(repository.root, record, {
					message: "All related tasks are closed",
					outcome: "completed",
					type: "SETTLE",
				});
			}
		}
	}
	if (record.state === "settling") {
		if (record.context.attemptId !== null) {
			const attempt = inventory.find(({ id }) => id === record.context.attemptId)!;
			evidence.step("drone.cancel", attempt.id);
			await cancelDroneReview(runtime, attempt.id);
			evidence.reference(attempt.receipt.directory);
			evidence.step("execution.stop", attempt.id);
			await stopExecution(attempt.receipt);
			evidence.completed("execution.stopped", attempt.id);
			evidence.step("stdout.publish", record.id);
			await publishStdoutActivity(repository, attempt.receipt, true);
			evidence.completed("stdout.published", record.id);
		}
		await finishSettlement(runtime, record, evidence);
	} else if (record.state === "retrying") {
		store.advanceRequest(repository.root, record, { now: Date.now(), type: "TICK" });
	}
}
async function reviewRunningAttempt(
	runtime: RequestRuntime,
	record: RequestRecord,
	attempt: AttemptInventory,
): Promise<RequestRecord> {
	const { repository, store } = runtime;
	const tasks = await Promise.all(
		record.context.taskIds.map((id) => showBead(repository, record.context.identity, id)),
	);
	if (tasks.every(({ status }) => status === "closed")) {
		await cancelDroneReview(runtime, attempt.id);
		return record;
	}
	const message = await reviewInactivity(runtime, record, attempt.receipt);
	if (message === undefined) {
		return record;
	}
	return store.advanceRequest(repository.root, record, { message, outcome: null, type: "SETTLE" });
}
async function publishRunningObservation(
	runtime: RequestRuntime,
	record: RequestRecord,
	attempt: AttemptInventory,
): Promise<void> {
	const { repository, store } = runtime;
	const review = store.latestDroneReview(repository.root, attempt.id);
	let fact = `running: attempt ${attempt.receipt.attemptNumber}`;
	if (review !== undefined) {
		fact += `; inactivity drone ${review.phase}; review ${review.id}; deadline ${new Date(review.deadline).toISOString()}`;
		if (review.decision !== null) {
			fact += `; ${review.decision.kind}; ${review.decision.detail}`;
		}
	}
	await publishObservation(repository, record.id, fact);
}
// eslint-disable-next-line max-statements -- Release claims and publish the settled fact before the final checkpoint.
async function finishSettlement(
	runtime: RequestRuntime,
	record: RequestRecord,
	evidence: OperationEvidence,
): Promise<void> {
	const { repository, store, config } = runtime;
	await releaseClaims(repository, record, evidence);
	const released = store.advanceRequest(repository.root, record, { type: "RELEASED" });
	const next = transitionRequest(released, {
		delay: config.retry_delay_ms,
		maxRetries: config.max_retries,
		now: Date.now(),
		type: "SETTLED",
	});
	let fact = `waiting: retry scheduled after attempt ${record.context.attempts}; ${record.context.message}`;
	if (next.state === "terminal") {
		fact = `settled: ${next.context.outcome}; ${record.context.message}`;
	}
	evidence.step("observation.publish", record.id);
	await publishObservation(repository, record.id, fact);
	evidence.completed("observation.published", record.id);
	if (next.state === "terminal") {
		evidence.step("tracker.show", record.id);
		const spawn = await showBead(repository, record.context.identity, record.id);
		if (spawn.status !== "closed") {
			evidence.step("tracker.close", record.id);
			await beads(repository, record.context.identity, [
				"close",
				record.id,
				"--reason",
				next.context.outcome!,
			]);
			evidence.completed("tracker.closed", record.id);
		}
		evidence.step("labels.publish", record.id);
		await publishRequestLabels(repository, record.context.identity, record.id);
		evidence.completed("labels.published", record.id);
	}
	store.saveRequest(repository.root, next);
}
