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
import { observeExecution, resumeExecution, stopExecution } from "./processes.ts";
import { publishObservation } from "./observations.ts";
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
		await reconcileRequest(runtime, saved, inventory);
	}
}

/** Acquire sequentially only after capacity is granted; each intent precedes its tracker write. */
// eslint-disable-next-line max-statements -- Claim checkpoints and partial-failure cleanup stay adjacent to their mutations.
export async function claimRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
): Promise<RequestRecord | null> {
	const { repository, store } = runtime;
	let record = store.advanceRequest(repository.root, saved, { type: "READY" });
	for (const id of record.context.taskIds) {
		record = store.advanceRequest(repository.root, record, { id, type: "INTEND" });
		// eslint-disable-next-line no-await-in-loop -- Persist each acquisition before the next task can be claimed.
		const outcome = await acquireClaim(repository, record.context.identity, id);
		if (outcome === "conflict") {
			record = store.advanceRequest(repository.root, record, {
				message: `Task ${id} changed reservation during acquisition`,
				outcome: "claim_failed",
				type: "SETTLE",
			});
			// eslint-disable-next-line no-await-in-loop -- No execution has launched; release only already recorded partial acquisitions.
			await finishSettlement(runtime, record);
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
		await finishSettlement(runtime, record);
		return null;
	}
	return record;
}

// --- Request effects ---
// eslint-disable-next-line max-statements -- Reconcile durable lifecycle state with current tracker and verified execution facts.
async function reconcileRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
	inventory: AttemptInventory[],
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
	const spawn = await showBead(repository, record.context.identity, record.id);
	const request = readSpawnRequest(spawn);
	assertRequestAuthority(record, request.identity, request.taskIds);
	const tasks = await Promise.all(
		record.context.taskIds.map((id) => showBead(repository, record.context.identity, id)),
	);
	if (record.state !== "settling") {
		if (spawn.status === "closed") {
			record = store.advanceRequest(repository.root, record, {
				message: "Spawn request closed",
				outcome: "cancelled",
				type: "SETTLE",
			});
		} else if (tasks.length > ZERO && tasks.every(({ status }) => status === "closed")) {
			record = store.advanceRequest(repository.root, record, {
				message: "All related tasks are closed",
				outcome: "completed",
				type: "SETTLE",
			});
		} else if (record.state === "executing") {
			const attempt = inventory.find(({ id }) => id === record.context.attemptId)!;
			await resumeExecution(attempt.receipt, (supervisor) =>
				store.supervisor(attempt.id, supervisor.pid),
			);
			const observed = await observeExecution(attempt.receipt);
			if (attempt.state === "exited" || attempt.state === "failed" || observed.kind === "stopped") {
				record = store.advanceRequest(repository.root, record, {
					message: "Execution stopped with unfinished work",
					outcome: null,
					type: "SETTLE",
				});
			} else if (attempt.state === "running") {
				await publishObservation(
					repository,
					record.id,
					`running: attempt ${attempt.receipt.attemptNumber}`,
				);
			}
		}
	}
	if (record.state === "settling") {
		if (record.context.attemptId !== null) {
			const attempt = inventory.find(({ id }) => id === record.context.attemptId)!;
			await stopExecution(attempt.receipt);
		}
		await finishSettlement(runtime, record);
	} else if (record.state === "retrying") {
		store.advanceRequest(repository.root, record, { now: Date.now(), type: "TICK" });
	}
}
// eslint-disable-next-line max-statements -- Release claims and publish the settled fact before the final checkpoint.
async function finishSettlement(runtime: RequestRuntime, record: RequestRecord): Promise<void> {
	const { repository, store, config } = runtime;
	await releaseClaims(repository, record);
	const released = store.advanceRequest(repository.root, record, { type: "RELEASED" });
	const next = transitionRequest(released, {
		delay: config.retry_delay_ms,
		maxRetries: config.max_retries,
		now: Date.now(),
		type: "SETTLED",
	});
	let fact = `waiting: retry scheduled after attempt ${record.context.attempts}`;
	if (next.state === "terminal") {
		fact = `settled: ${next.context.outcome}; ${record.context.message}`;
	}
	await publishObservation(repository, record.id, fact);
	if (next.state === "terminal") {
		const spawn = await showBead(repository, record.context.identity, record.id);
		if (spawn.status !== "closed") {
			await beads(repository, record.context.identity, [
				"close",
				record.id,
				"--reason",
				next.context.outcome!,
			]);
		}
	}
	store.saveRequest(repository.root, next);
}
