/* eslint-disable import/max-dependencies --
 * Request reconciliation composes claims, execution and operation evidence.
 */
/* eslint-disable unicorn/no-null --
 * Durable JSON checkpoints explicitly preserve absent attempt, claim, deadline and
 * outcome fields.
 */
import type { AttemptInventory, Store } from "./store.ts";
import type { BeesConfig, RepositoryEndpoint, SpawnRequest } from "@hive/shared";
import type { RunningObservationContext, RunningObservationInput } from "./observations.ts";
import {
	RunningStdoutPublicationError,
	publishObservation,
	publishRunningObservations,
	publishRunningStdoutActivities,
	publishStdoutActivity,
	runningObservationCurrent,
} from "./observations.ts";
import { acquireClaim, releaseClaims } from "./claims.ts";
import { assign, setup, transition } from "xstate";
import { observeExecution, resumeExecution, stopExecution } from "./processes.ts";
import {
	readSpawnRequest,
	requestOutcomeSchema,
	requestStateSchema,
	workflowAssignmentSchema,
} from "@hive/shared";
import type { Bead } from "@hive/beads";
import type { LaunchReceipt } from "./launch.ts";
import type { OperationEvidence } from "./history.ts";
import type { TrackerContext } from "./tracker.ts";
import type { WorkflowCompletion } from "./workflow-anchor.ts";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Durable checkpoints retain authority only on their requesting host.
 */
import { hostname } from "node:os";
import { publishRequestLabels } from "./requests.ts";
import { readFinishReport } from "./launch.ts";
import { readWorkflowCompletion } from "./workflow-anchor.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const RUNNING_STDOUT_COHORT_SIZE = 4;
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
	/** Immutable workflow role and completion scope captured before any claim or launch. */
	assignment: workflowAssignmentSchema,
	/** Selected tracker authority retained independently of membership and attempts. */
	beadsDb: z.string(),
	/** Missing historical provenance stays unbound and cannot be reconciled. */
	host: z.string().trim().min(ONE).nullable().default(null),
	context: contextSchema,
	id: z.string(),
	state: requestStateSchema,
});
export type RequestStore = Pick<
	Store,
	| "advanceRequest"
	| "history"
	| "inventory"
	| "request"
	| "requests"
	| "retainedInventory"
	| "saveRequest"
	| "supervisor"
>;
interface RequestRuntime extends TrackerContext {
	/** Durable request and attempt checkpoints. */
	store: RequestStore;
	/** Current canonical retry policy. */
	config: BeesConfig;
}
interface RunningPublication extends RunningObservationInput {
	/** Original checkpoint whose current attempt survived lifecycle reconciliation. */
	record: RequestRecord;
	/** Immutable receipt, retained for the local evidence recheck. */
	receipt: LaunchReceipt;
}
interface RunningPublicationEvidence {
	/** Checkpoint reread after candidate collection. */
	record: RequestRecord | undefined;
	/** Refreshed current attempt, not an adopted replacement. */
	attempt: AttemptInventory | undefined;
	/** Fresh owned-process observation. */
	execution: Awaited<ReturnType<typeof observeExecution>>;
	/** Fresh finish report for the captured attempt only. */
	finish: Awaited<ReturnType<typeof readFinishReport>>;
}
export type RequestRecord = z.infer<typeof requestRecordSchema>;
type RequestContext = z.infer<typeof contextSchema>;
export type RequestEvent =
	| { type: "READY" }
	| { type: "WAIT"; message: string }
	| { type: "INTEND"; id: string }
	| { type: "ACQUIRED"; id: string }
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

/** A request keeps its captured workflow scope, identity and tasks across every attempt. */
export function newRequest(spawn: Bead, repository: RepositoryEndpoint): RequestRecord {
	const request = readSpawnRequest(spawn);
	return {
		assignment: request.assignment,
		beadsDb: repository.beadsDb,
		host: request.host,
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
/**
 * XState's assign-only machine selects lifecycle transitions without a running actor.
 * Callers own persistence and effect ordering (see acquireRequest and finishSettlement).
 */
export function transitionRequest(record: RequestRecord, event: RequestEvent): RequestRecord {
	const snapshot = machine.resolveState({ context: record.context, value: record.state });
	const [next] = transition(machine, snapshot, event);
	return { ...record, context: next.context, state: next.value as RequestRecord["state"] };
}

/** External spawn edits cannot change the authority already used for claims and retries. */
export function assertRequestAuthority(
	record: RequestRecord,
	{
		assignment,
		identity,
		taskIds,
		host,
	}: Pick<SpawnRequest, "assignment" | "identity" | "taskIds" | "host">,
): void {
	if (
		assignment.kind !== record.assignment.kind ||
		assignment.runId !== record.assignment.runId ||
		(assignment.kind === "stage" &&
			record.assignment.kind === "stage" &&
			assignment.stageId !== record.assignment.stageId) ||
		host !== record.host ||
		identity !== record.context.identity ||
		taskIds.length !== record.context.taskIds.length ||
		!taskIds.every((id) => record.context.taskIds.includes(id))
	) {
		throw new Error(
			`Request ${record.id} changed its captured workflow assignment, host, identity or related tasks`,
		);
	}
}

/** Awake passes resume durable checkpoints before considering replacement launches. */
// eslint-disable-next-line max-statements -- Collect only surviving stable requests; lifecycle effects remain serial.
export async function reconcileRequests(runtime: RequestRuntime): Promise<void> {
	const { beads, repository, store } = runtime;
	const records = store
		.requests(repository.root)
		.filter(({ state, host }) => state !== "terminal" && host === hostname());
	const details = await beads.showMany(
		trackerScope(repository, "sys-colony"),
		records.map(({ id }) => id),
	);
	const spawns = new Map(details.map((spawn) => [spawn.id, spawn]));
	let running: RunningPublication[] = [];
	for (const saved of records) {
		const spawn = spawns.get(saved.id);
		if (!spawn) {
			throw new Error(`Missing retained request ${saved.id} in native detail batch`);
		}
		/* eslint-disable-next-line no-await-in-loop --
		 * Finish each request's serial lifecycle effects before collecting deferred stdout.
		 */
		const candidate = await reconcileWithHistory(runtime, saved, spawn);
		if (candidate) {
			running.push(candidate);
		}
		if (running.length === RUNNING_STDOUT_COHORT_SIZE) {
			// eslint-disable-next-line no-await-in-loop -- Drain each freshly gated cohort before collecting another.
			await reconcileRunningCohort(runtime, running);
			running = [];
		}
	}
	await reconcileRunningCohort(runtime, running);
}

/**
 * Compare captured authority with fresh local evidence. Lifecycle drift returns false for
 * serial reconciliation; mutation of the captured same-ID receipt throws instead.
 */
export function runningPublicationStillCurrent(
	captured: Pick<RunningPublication, "record" | "receipt">,
	current: RunningPublicationEvidence,
): boolean {
	assertRunningReceipt(captured, current.attempt);
	return (
		current.record?.state === "executing" &&
		current.record.context.attemptId === captured.receipt.id &&
		JSON.stringify(current.record) === JSON.stringify(captured.record) &&
		current.attempt?.id === captured.receipt.id &&
		current.attempt.state === "running" &&
		current.execution.kind === "live" &&
		current.finish === undefined
	);
}

/* eslint-disable-next-line max-statements --
 * Establish request-attributed history before the batch gate, then drain every history outcome.
 */
export async function publishRunningCohortWithHistory(
	runtime: RunningObservationContext & {
		store: Pick<Store, "history" | "request">;
	},
	inputs: readonly (RunningObservationInput & { record: Pick<RequestRecord, "id"> })[],
	publish: typeof publishRunningStdoutActivities = publishRunningStdoutActivities,
): Promise<void> {
	const { repository, store } = runtime;
	const ready = inputs.map(() => Promise.withResolvers<void>());
	const completion = Promise.withResolvers<PromiseSettledResult<void>>();
	const histories = inputs.map(async (input, index) => {
		try {
			await store.history.run(
				{
					checkpoint: () => store.request(repository.root, input.record.id),
					operation: "reconcile",
					repository,
					requestId: input.record.id,
				},
				async (evidence) => {
					evidence.reference(input.receipt.directory);
					// Record entry into cohort publication, not confirmation of this request's comment.
					evidence.step("observations.publish-running-stdout", input.record.id);
					ready[index]!.resolve();
					const outcome = publicationOutcome(await completion.promise, input.record.id);
					if (outcome.status === "rejected") {
						throw outcome.reason;
					}
				},
			);
		} catch (error) {
			ready[index]!.reject(error);
			throw error;
		}
	});
	const drained = Promise.allSettled(histories);
	// eslint-disable-next-line init-declarations -- The try/catch assigns the actual outcome, never an assumed success.
	let publication: PromiseSettledResult<void>;
	try {
		await Promise.all(ready.map(({ promise }) => promise));
		await publish(runtime, inputs);
		publication = { status: "fulfilled", value: undefined };
	} catch (error) {
		publication = { status: "rejected", reason: error };
	}
	completion.resolve(publication);
	const results = await drained;
	const secondary = results.flatMap((result, index) => {
		const expected = publicationOutcome(publication, inputs[index]!.record.id);
		if (
			result.status === "rejected" &&
			(expected.status !== "rejected" || result.reason !== expected.reason)
		) {
			return [
				new Error(`Request ${inputs[index]!.record.id} stdout publication history failed`, {
					cause: result.reason,
				}),
			];
		}
		return [];
	});
	if (secondary.length > ZERO) {
		if (publication.status === "rejected") {
			secondary.unshift(publication.reason);
		}
		throw new AggregateError(secondary, "Running stdout publication/history failed");
	}
	if (publication.status === "rejected") {
		throw publication.reason;
	}
}

/** Acquire sequentially only after capacity is granted; each intent precedes its tracker write. */
/* eslint-disable-next-line max-statements --
 * Claim checkpoints and partial-failure cleanup stay adjacent to their mutations.
 */
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

/* eslint-disable-next-line max-statements --
 * Acquisition checkpoints and partial failure settlement remain ordered together.
 */
async function acquireRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
	evidence: OperationEvidence,
): Promise<RequestRecord | null> {
	const { beads, repository, store } = runtime;
	const spawn = await beads.show(trackerScope(repository, saved.context.identity), saved.id);
	const request = readSpawnRequest(spawn);
	assertRequestAuthority(saved, request);
	if (request.host !== hostname()) {
		throw new Error(`Request ${saved.id} is not bound to this host`);
	}
	if (spawn.status !== "open") {
		return null;
	}
	await readWorkflowCompletion(runtime, saved.assignment, saved.context.identity);
	let record = store.advanceRequest(repository.root, saved, { type: "READY" });
	for (const id of record.context.taskIds) {
		record = store.advanceRequest(repository.root, record, { id, type: "INTEND" });
		// eslint-disable-next-line no-await-in-loop -- Persist each acquisition before the next task can be claimed.
		const outcome = await acquireClaim(
			runtime,
			{ identity: record.context.identity, assignment: record.assignment },
			id,
			evidence,
		);
		if (typeof outcome !== "string") {
			record = store.advanceRequest(repository.root, record, {
				message: outcome.message,
				outcome: outcome.outcome,
				type: "SETTLE",
			});
			// eslint-disable-next-line no-await-in-loop -- A terminal anchor ends acquisition before process reservation.
			await finishSettlement(runtime, record, evidence);
			return null;
		}
		if (outcome === "conflict") {
			record = store.advanceRequest(repository.root, record, {
				message: `Task ${id} changed reservation during acquisition`,
				outcome: "claim_failed",
				type: "SETTLE",
			});
			/* eslint-disable-next-line no-await-in-loop --
			 * No execution has launched; release only already recorded partial acquisitions.
			 */
			await finishSettlement(runtime, record, evidence);
			return null;
		}
		record = store.advanceRequest(repository.root, record, { id, type: "ACQUIRED" });
	}
	return record;
}

// --- Request effects ---
// eslint-disable-next-line max-params -- Serial fallback bypasses collection without changing the lifecycle reconciler.
function reconcileWithHistory(
	runtime: RequestRuntime,
	saved: RequestRecord,
	spawn: Bead,
	serial = false,
): Promise<RunningPublication | undefined> {
	const { repository, store } = runtime;
	return store.history.run(
		{
			checkpoint: () => store.request(repository.root, saved.id),
			operation: "reconcile",
			repository,
			requestId: saved.id,
		},
		async (evidence) => {
			const candidate = await reconcileRequest(runtime, saved, spawn, evidence);
			if (serial && candidate) {
				evidence.step("observations.publish-running", saved.id);
				await publishRunningObservations(runtime, candidate.receipt, spawn);
				return;
			}
			return candidate;
		},
	);
}

// eslint-disable-next-line max-statements -- Abandon drifting cohorts once, preserving serial lifecycle precedence.
async function reconcileRunningCohort(
	runtime: RequestRuntime,
	inputs: readonly RunningPublication[],
): Promise<void> {
	if (inputs.length === ZERO) {
		return;
	}
	if (!(await runningCohortCurrent(runtime, inputs))) {
		const { beads, repository, store } = runtime;
		for (const input of inputs) {
			assertRunningReceipt(
				input,
				store
					.retainedInventory(repository.root, input.record.id)
					.find(({ id }) => id === input.receipt.id),
			);
			// eslint-disable-next-line no-await-in-loop -- Drift abandons batching once; use ordinary fresh serial detail.
			const spawn = await beads.show(trackerScope(repository, "sys-colony"), input.record.id);
			assertRequestAuthority(input.record, readSpawnRequest(spawn));
			const current = store.request(repository.root, input.record.id);
			if (!current || current.context.attemptId !== input.receipt.id) {
				throw new Error(
					`Request ${input.record.id} changed its current attempt before publication`,
				);
			}
			// eslint-disable-next-line no-await-in-loop -- Do not adopt a replacement or re-plan a second batch.
			await reconcileWithHistory(runtime, current, spawn, true);
		}
		return;
	}
	await publishRunningCohortWithHistory(runtime, inputs);
}

// eslint-disable-next-line max-statements -- Revalidate captured local evidence before final tracker admission.
async function runningCohortCurrent(
	{ repository, store }: RequestRuntime,
	inputs: readonly RunningPublication[],
): Promise<boolean> {
	const inventory = await store.inventory(
		repository.root,
		new Set(inputs.map(({ record }) => record.id)),
	);
	for (const input of inputs) {
		const current = store.request(repository.root, input.record.id);
		const attempt = inventory.find(({ id }) => id === input.receipt.id);
		assertRunningReceipt(input, attempt);
		if (
			!current ||
			current.state !== "executing" ||
			current.context.attemptId !== input.receipt.id ||
			JSON.stringify(current) !== JSON.stringify(input.record) ||
			!attempt ||
			attempt.state !== "running"
		) {
			return false;
		}
		// eslint-disable-next-line no-await-in-loop -- Sample each owned execution serially before cohort admission.
		const execution = await observeExecution(attempt.receipt);
		// eslint-disable-next-line no-await-in-loop -- Only the captured current attempt can supply finish evidence.
		const finish = await readFinishReport(attempt.receipt);
		if (
			!runningPublicationStillCurrent(input, {
				record: store.request(repository.root, input.record.id),
				attempt,
				execution,
				finish,
			})
		) {
			return false;
		}
	}
	return true;
}

function assertRunningReceipt(
	captured: Pick<RunningPublication, "record" | "receipt">,
	attempt: AttemptInventory | undefined,
): void {
	if (
		attempt?.id === captured.receipt.id &&
		JSON.stringify(attempt.receipt) !== JSON.stringify(captured.receipt)
	) {
		throw new Error(
			`Request ${captured.record.id} changed its immutable attempt receipt before publication`,
		);
	}
}

function publicationOutcome(
	publication: PromiseSettledResult<void>,
	id: string,
): PromiseSettledResult<void> {
	if (
		publication.status === "rejected" &&
		publication.reason instanceof RunningStdoutPublicationError
	) {
		const failure = publication.reason.failures.find(({ requestId }) => requestId === id);
		if (failure) {
			return { status: "rejected", reason: failure.error };
		}
		return { status: "fulfilled", value: undefined };
	}
	return publication;
}

/* eslint-disable-next-line max-statements, max-params --
 * Reconcile durable lifecycle state with current tracker and verified execution facts.
 */
async function reconcileRequest(
	runtime: RequestRuntime,
	saved: RequestRecord,
	spawn: Bead,
	evidence: OperationEvidence,
): Promise<RunningPublication | undefined> {
	const { beads, repository, store } = runtime;
	let record = saved;
	const request = readSpawnRequest(spawn);
	assertRequestAuthority(record, request);
	for (const { receipt } of store
		.retainedInventory(repository.root)
		.filter(({ spawnId }) => spawnId === record.id)) {
		assertRequestAuthority(record, receipt);
	}
	const inventory = await store.inventory(repository.root, new Set([record.id]));
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
				let completion: WorkflowCompletion | undefined = undefined;
				if (report?.outcome !== "blocked") {
					completion = await readWorkflowCompletion(
						runtime,
						record.assignment,
						record.context.identity,
					);
				}
				let outcome: RequestContext["outcome"] = null;
				let message = "Execution stopped with unfinished work";
				if (report?.outcome === "blocked") {
					const tasks = await Promise.all(
						record.context.taskIds.map((id) =>
							beads.show(trackerScope(repository, record.context.identity), id),
						),
					);
					const unfinished = tasks.filter(({ status }) => status !== "closed");
					outcome = "blocked";
					message =
						`Self-report blocked; attempt ${attempt.id}; unfinished tasks: ` +
						`${unfinished.map(({ id }) => id).join(", ")}; reason: ` +
						`${report.reason}`;
				} else if (completion?.kind === "terminal") {
					({ outcome } = completion);
					message = `${completion.message}; attempt ${attempt.id}`;
				} else if (report?.outcome === "success") {
					message = `Self-report success with unfinished work; attempt ${attempt.id}`;
				}
				record = store.advanceRequest(repository.root, record, {
					message,
					outcome,
					type: "SETTLE",
				});
			} else if (attempt.state === "running") {
				evidence.step("tracker.show-related", record.id);
				const completion = await readWorkflowCompletion(
					runtime,
					record.assignment,
					record.context.identity,
				);
				const input = { receipt: attempt.receipt, snapshot: spawn, record };
				if (completion.kind === "terminal" && completion.outcome !== "completed") {
					record = store.advanceRequest(repository.root, record, {
						message: completion.message,
						outcome: completion.outcome,
						type: "SETTLE",
					});
				} else if (runningObservationCurrent(input)) {
					return input;
				} else {
					// Record the composite publication call, not confirmation of either comment write.
					evidence.step("observations.publish-running", record.id);
					await publishRunningObservations(runtime, attempt.receipt, spawn);
				}
			}
		} else {
			evidence.step("tracker.show-related", record.id);
			const completion = await readWorkflowCompletion(
				runtime,
				record.assignment,
				record.context.identity,
			);
			if (completion.kind === "terminal") {
				record = store.advanceRequest(repository.root, record, {
					message: completion.message,
					outcome: completion.outcome,
					type: "SETTLE",
				});
			}
		}
	}
	if (record.state === "settling") {
		if (record.context.attemptId !== null) {
			const attempt = inventory.find(({ id }) => id === record.context.attemptId)!;
			evidence.reference(attempt.receipt.directory);
			evidence.step("execution.stop", attempt.id);
			await stopExecution(attempt.receipt);
			evidence.completed("execution.stopped", attempt.id);
			evidence.step("stdout.publish", record.id);
			await publishStdoutActivity(runtime, attempt.receipt, true);
			evidence.completed("stdout.published", record.id);
		}
		await finishSettlement(runtime, record, evidence);
	} else if (record.state === "retrying") {
		store.advanceRequest(repository.root, record, { now: Date.now(), type: "TICK" });
	}
	return undefined;
}
// eslint-disable-next-line max-statements -- Release claims and publish the settled fact before the final checkpoint.
async function finishSettlement(
	runtime: RequestRuntime,
	record: RequestRecord,
	evidence: OperationEvidence,
): Promise<void> {
	const { beads, repository, store, config } = runtime;
	await releaseClaims(runtime, record, evidence);
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
	await publishObservation(runtime, record.id, fact);
	evidence.completed("observation.published", record.id);
	if (next.state === "terminal") {
		evidence.step("tracker.show", record.id);
		const spawn = await beads.show(trackerScope(repository, record.context.identity), record.id);
		if (spawn.status !== "closed") {
			evidence.step("tracker.close", record.id);
			await beads.close(trackerScope(repository, "sys-colony"), record.id, {
				reason: next.context.outcome!,
			});
			evidence.completed("tracker.closed", record.id);
		}
		evidence.step("labels.publish", record.id);
		await publishRequestLabels(runtime, "sys-colony", record.id, hostname());
		evidence.completed("labels.published", record.id);
	}
	store.saveRequest(repository.root, next);
}
