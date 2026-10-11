/* eslint-disable unicorn/no-null -- Diagnostic JSON explicitly represents absent evidence and unknown record times. */
import type { ColonyInspection, RepositoryEndpoint, SpawnDisposition } from "@hive/shared";
import { DaemonUnavailableError, requestServer } from "./client.ts";
import { capacityConstraints, hasCapacity } from "./scheduler.ts";
import { eligibility, launchBucket, launchReceiptSchema } from "./launch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the same execution bucket as launch preparation.
import { join, resolve } from "node:path";
import {
	latestColonyObservation,
	readSpawnRequest,
	requestDisposition,
	requestLabelsCurrent,
} from "@hive/shared";
import type { Bead } from "@hive/beads";
import type { Occupant } from "./scheduler.ts";
import type { ServerTarget } from "./client.ts";
import type { TrackerContext } from "./tracker.ts";
import { observeExecution } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Canonicalize execution cwd without creating it.
import { realpath } from "node:fs/promises";
import { trackerScope } from "./tracker.ts";

interface Evidence<Value> {
	/** Authority or concrete observation boundary. */
	source: string;
	/** Time this read completed, never a claim of atomic cross-source sampling. */
	observedAt: string;
	/** Age semantics applying to every enclosed fact. */
	freshness: "sampled" | "checkpoint_age_unknown";
	/** Parsed evidence, or an explicit unavailable reason. */
	result:
		| { kind: "available"; value: Value }
		| { kind: "unavailable"; reason: string; message: string };
}
interface TaskFact {
	/** Native task identifier. */
	id: string;
	/** Last native task revision. */
	updatedAt: string;
	/** Native lifecycle. */
	status: string;
	/** Native assignment, distinct from process ownership. */
	assignee: string | null;
	/** Human participation reservation. */
	hitl: boolean;
	/** Membership in the scheduler's native ready query. */
	ready: boolean;
	/** Direct native dependency edges; readiness remains native Beads authority. */
	dependencies: (Bead["dependencies"][number] & { status: string; updatedAt: string })[];
}
interface TrackerFacts {
	/** Captured capacity inputs; private prompt and invocation are excluded. */
	execution: { kind: string; cwd: string | null };
	/** Native request lifecycle. */
	status: string;
	/** Last request revision; task revisions are recorded separately. */
	updatedAt: string;
	/** Captured execution identity. */
	identity: string;
	/** Approved native outcome/resolution vocabulary. */
	disposition: SpawnDisposition;
	/** Whether query labels match native authority. */
	labelPublication: "current" | "pending";
	/** Native closure explanation. */
	closeReason: string | null;
	/** Related task readiness and reservation evidence. */
	tasks: TaskFact[];
	/** Scheduler's shared eligibility decision, before capacity or claims. */
	eligibility: ReturnType<typeof eligibility>["kind"];
	/** Shared eligibility diagnostic, when waiting. */
	message: string | null;
	/** Historical native comment with its original timestamp; never current process proof. */
	lastObservation: ReturnType<typeof latestColonyObservation> | null;
}
interface RuntimeFacts {
	/** Live loop state and active policy from the selected daemon. */
	colony: ColonyInspection["colony"];
	/** Last reconciled request, whose reconciliation timestamp is not retained. */
	checkpoint: ColonyInspection["requests"][number] | null;
	/** Retained attempts for this request, without refreshing their checkpoint state. */
	attempts: ColonyInspection["attempts"];
}
interface CapacityFacts {
	/** Same canonical kind/bucket as launch preparation. */
	candidate: Occupant;
	/** Retained starting/running reservations counted by dispatch. */
	occupied: Occupant[];
	/** Active policy limits, not canonical configuration guesses. */
	limits: NonNullable<NonNullable<ColonyInspection["colony"]>["policy"]>["limits"];
	/** Shared scheduler decision, not a slot reservation or queue-position prediction. */
	available: boolean;
}
interface ProcessFact {
	/** Attempt whose immutable authority was verified. */
	attemptId: string;
	/** Sampled owned execution liveness. Live includes a supervisor awaiting launch. */
	evidence: Evidence<"live" | "stopped">;
}
export interface Diagnostic {
	/** Stable condition discriminator, independent of message wording. */
	code: string;
	/** Blocking, progress, disagreement or unavailable evidence. */
	kind: "blocker" | "progress" | "disagreement" | "unknown";
	/** Concrete explanation. */
	message: string;
	/** Condition for the next transition; explain never performs it. */
	nextTransition: string;
	/** Evidence group names establishing this conclusion. */
	evidence: string[];
}
export interface Explanation {
	/** Public command result discriminator. */
	kind: "explanation";
	/** Inspected native spawn identifier. */
	id: string;
	/** Explicit repository/tracker authority. */
	repository: RepositoryEndpoint;
	/** Native facts read independently from runtime evidence. */
	tracker: Evidence<TrackerFacts>;
	/** Daemon read time encloses historical checkpoint facts; their age remains unknown. */
	runtime: Evidence<RuntimeFacts>;
	/** Capacity at the inspection's retained reservation snapshot. */
	capacity: Evidence<CapacityFacts>;
	/** Fresh process checks, kept separate from checkpoint state. */
	processes: ProcessFact[];
	/** Conditions and disagreements derived only from named evidence. */
	diagnostics: Diagnostic[];
}

/** Bounded read-only composition; never opens the daemon database or invokes a lifecycle action. */
export async function explainRequest(
	id: string,
	context: TrackerContext,
	target: ServerTarget,
): Promise<Explanation> {
	const { repository } = context;
	const [tracker, inspection] = await Promise.all([
		capture("native Beads show/ready", "sampled", () => trackerFacts(id, context)),
		capture(`daemon inspect ${target.socket}`, "checkpoint_age_unknown", async () => {
			const response = await requestServer(target, { kind: "inspect", repository });
			if (response.kind !== "inspection") {
				throw new Error("Expected inspection response");
			}
			return response;
		}),
	]);
	const runtime = runtimeEvidence(id, inspection);
	const [capacity, processes] = await Promise.all([
		capture(
			"dispatch hasCapacity: active policy and retained reservations",
			"checkpoint_age_unknown",
			// eslint-disable-next-line max-statements -- Read active policy and canonical capacity inputs without reserving a slot.
			async () => {
				if (inspection.result.kind === "unavailable") {
					throw new Error("Daemon inspection unavailable");
				}
				const { colony, attempts } = inspection.result.value;
				if (colony?.policy === null || colony === null) {
					throw new Error("No active scheduling policy");
				}
				if (tracker.result.kind === "unavailable") {
					throw new Error("Tracker execution inputs unavailable");
				}
				const { execution } = tracker.result.value;
				const cwd = await realpath(resolve(repository.root, execution.cwd ?? "."));
				const candidate = { bucket: await launchBucket(cwd), kind: execution.kind };
				const occupied = attempts
					.filter(({ state }) => state === "starting" || state === "running")
					.map((attempt) => ({ bucket: attempt.bucket, kind: attempt.kind }));
				return {
					available: hasCapacity(candidate, occupied, colony.policy.limits),
					candidate,
					limits: colony.policy.limits,
					occupied,
				};
			},
		),
		observeAttempts(id, repository, runtime),
	]);
	const result: Explanation = {
		capacity,
		diagnostics: [],
		id,
		kind: "explanation",
		processes,
		repository,
		runtime,
		tracker,
	};
	return { ...result, diagnostics: explainConditions(result) };
}

/** Interpret evidence without inventing scheduling authority or reconciling disagreement. */
// eslint-disable-next-line max-statements -- Keep independent authority conditions visible in one diagnostic pass.
export function explainConditions(result: Omit<Explanation, "diagnostics">): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const add = (diagnostic: Diagnostic) => {
		diagnostics.push(diagnostic);
	};
	for (const name of ["tracker", "runtime", "capacity"] as const) {
		const evidence = result[name];
		if (evidence.result.kind === "unavailable") {
			add({
				code: `${name}_unavailable`,
				evidence: [name],
				kind: "unknown",
				message: evidence.result.message,
				nextTransition: `Obtain ${name} evidence before concluding readiness or runtime health.`,
			});
		}
	}
	const tracker = availableValue(result.tracker);
	const runtime = availableValue(result.runtime);
	if (tracker !== null) {
		trackerConditions(tracker, add, runtime?.checkpoint?.state === "executing");
	}
	if (runtime !== null) {
		runtimeConditions(runtime, add);
		if (tracker !== null && runtime.checkpoint !== null) {
			authorityConditions(tracker, runtime.checkpoint, add);
		}
	}
	const capacity = result.capacity.result;
	if (
		capacity.kind === "available" &&
		!capacity.value.available &&
		tracker?.status === "open" &&
		!runtime?.checkpoint?.attemptId
	) {
		add({
			code: "capacity",
			evidence: ["capacity"],
			kind: "blocker",
			message: `Capacity unavailable: ${capacityConstraints(
				capacity.value.candidate,
				capacity.value.occupied,
				capacity.value.limits,
			)
				.filter(({ used, maximum }) => used >= maximum)
				.map(({ scope, used, maximum }) => `${scope} ${used}/${maximum}`)
				.join(", ")}. Counts are retained reservations.`,
			nextTransition:
				"A counted reservation must be released by Colony or the limiting policy must change; the next dispatch pass must still acquire claims.",
		});
	}
	processConditions(result, add);
	if (
		tracker?.status === "closed" &&
		runtime?.checkpoint &&
		runtime.checkpoint.state !== "terminal"
	) {
		add({
			code: "closure_checkpoint",
			evidence: ["tracker", "runtime"],
			kind: "disagreement",
			message: "Native request is closed but its checkpoint is nonterminal.",
			nextTransition:
				"An awake reconciliation pass must observe closure and finish any owned execution cleanup.",
		});
	}
	if (tracker?.status === "open" && runtime?.checkpoint?.state === "terminal") {
		add({
			code: "open_terminal",
			evidence: ["tracker", "runtime"],
			kind: "disagreement",
			message: "Native request is open but its checkpoint is terminal.",
			nextTransition:
				"Resolve the native/checkpoint disagreement before expecting another dispatch; this inspection cannot establish a safe transition.",
		});
	}
	if (
		tracker?.status === "open" &&
		tracker.eligibility === "eligible" &&
		runtime?.colony?.state === "awake" &&
		capacity.kind === "available" &&
		capacity.value.available &&
		(!runtime.checkpoint || runtime.checkpoint.state === "waiting")
	) {
		add({
			code: "runnable",
			evidence: ["tracker", "runtime", "capacity"],
			kind: "progress",
			message: "No eligibility or capacity blocker observed at these samples.",
			nextTransition:
				"An awake dispatch pass must rank this request, prepare the captured formula, recheck capacity and acquire all task claims; this is not a launch guarantee.",
		});
	}
	return diagnostics;
}

// --- Private functions ---
async function capture<Value>(
	source: string,
	freshness: Evidence<Value>["freshness"],
	read: () => Promise<Value>,
): Promise<Evidence<Value>> {
	try {
		const value = await read();
		return {
			freshness,
			observedAt: new Date().toISOString(),
			result: { kind: "available", value },
			source,
		};
	} catch (error) {
		return {
			freshness,
			observedAt: new Date().toISOString(),
			result: {
				kind: "unavailable",
				message: String(error),
				reason: unavailableReason(error),
			},
			source,
		};
	}
}
async function trackerFacts(
	id: string,
	{ beads, repository }: TrackerContext,
): Promise<TrackerFacts> {
	const spawn = await beads.show(trackerScope(repository, "colony"), id);
	const request = readSpawnRequest(spawn);
	const [tasks, ready] = await Promise.all([
		Promise.all(
			request.taskIds.map((task) => beads.show(trackerScope(repository, "colony"), task)),
		),
		beads.ready(trackerScope(repository, request.identity), { limit: 0 }),
	]);
	const decision = eligibility(tasks, ready, request.identity);
	return {
		closeReason: spawn.close_reason ?? null,
		disposition: requestDisposition(spawn),
		eligibility: decision.kind,
		execution: { cwd: request.recipe.cwd, kind: request.recipe.kind },
		identity: request.identity,
		labelPublication: labelPublication(spawn),
		lastObservation: latestColonyObservation(spawn) ?? null,
		message: waitingMessage(decision),
		status: spawn.status,
		tasks: await Promise.all(
			tasks.map(async (task) => ({
				assignee: task.assignee ?? null,
				dependencies: await Promise.all(
					task.dependencies.map(async (edge) => {
						const dependency = await beads.show(trackerScope(repository, "colony"), edge.id);
						return { ...edge, status: dependency.status, updatedAt: dependency.updated_at };
					}),
				),
				hitl: task.labels.includes("hitl"),
				id: task.id,
				ready: ready.some((item) => item.id === task.id),
				status: task.status,
				updatedAt: task.updated_at,
			})),
		),
		updatedAt: spawn.updated_at,
	};
}
function runtimeEvidence(id: string, evidence: Evidence<ColonyInspection>): Evidence<RuntimeFacts> {
	if (evidence.result.kind === "unavailable") {
		return { ...evidence, result: evidence.result };
	}
	const { colony, requests, attempts } = evidence.result.value;
	return {
		...evidence,
		result: {
			kind: "available",
			value: {
				attempts: attempts.filter(({ spawnId }) => spawnId === id),
				checkpoint: requests.find((request) => request.id === id) ?? null,
				colony,
			},
		},
	};
}
function observeAttempts(
	id: string,
	repository: RepositoryEndpoint,
	runtime: Evidence<RuntimeFacts>,
): Promise<ProcessFact[]> {
	if (runtime.result.kind === "unavailable") {
		return Promise.resolve([]);
	}
	return Promise.all(
		runtime.result.value.attempts.map(async (attempt) => ({
			attemptId: attempt.id,
			evidence: await capture(
				`verified process ownership ${attempt.paths.receipt}`,
				"sampled",
				async () => {
					const receipt = launchReceiptSchema.parse(await Bun.file(attempt.paths.receipt).json());
					if (
						receipt.id !== attempt.id ||
						receipt.spawnId !== id ||
						receipt.beadsDb !== repository.beadsDb
					) {
						throw new Error("Receipt does not match inspected attempt authority");
					}
					if (
						!(await Bun.file(join(receipt.directory, "ownership.json")).exists()) &&
						!(await Bun.file(join(receipt.directory, "supervisor.json")).exists())
					) {
						throw new Error("No ownership or supervisor handoff evidence; process state unknown");
					}
					const observed = await observeExecution(receipt);
					return observed.kind;
				},
			),
		})),
	);
}
type AddDiagnostic = (diagnostic: Diagnostic) => void;
// eslint-disable-next-line max-statements -- Native settlement and new-attempt eligibility are separate from an executing checkpoint.
function trackerConditions(tracker: TrackerFacts, add: AddDiagnostic, executing: boolean): void {
	if (tracker.status !== "open") {
		add({
			code: "request_closed",
			evidence: ["tracker"],
			kind: "progress",
			message: `Native request is ${tracker.status}; outcome ${tracker.disposition.outcome}, resolution ${tracker.disposition.resolution}.`,
			nextTransition:
				"No further launch is scheduled for a closed request. Unresolved failure needs an explicit operator decision; running cleanup remains separate.",
		});
		if (
			tracker.disposition.outcome === "failed" &&
			tracker.disposition.resolution === "unresolved"
		) {
			add({
				code: "failure_attention",
				evidence: ["tracker"],
				kind: "blocker",
				message: `Request failed and remains unresolved: ${tracker.closeReason ?? "no closure reason recorded"}.`,
				nextTransition:
					"An explicit operator decision is required to resolve the failure or submit a linked replacement; this closed request will not retry automatically.",
			});
		}
		return;
	}
	if (tracker.eligibility === "finished") {
		let nextTransition = "An awake pass must settle the request and publish its outcome.";
		if (executing) {
			nextTransition =
				"The bee retains its live execution for cleanup and reporting; a finish report or process exit allows Colony to settle it.";
		}
		add({
			code: "tasks_finished",
			evidence: ["tracker"],
			kind: "progress",
			message: "All related tasks are closed.",
			nextTransition,
		});
	}
	if (executing) {
		return;
	}
	if (tracker.eligibility === "waiting") {
		add({
			code: "eligibility",
			evidence: ["tracker"],
			kind: "blocker",
			message: tracker.message ?? "Request is not eligible.",
			nextTransition:
				"Every unfinished task must be native-ready, not hitl, and unassigned or assigned to the captured identity; at least one related task is required.",
		});
	}
	for (const task of tracker.tasks.filter((item) => item.status !== "closed")) {
		taskConditions(task, tracker.identity, add);
	}
}
function taskConditions(task: TaskFact, identity: string, add: AddDiagnostic): void {
	if (task.assignee !== null && task.assignee !== identity) {
		add({
			code: "claim",
			evidence: ["tracker"],
			kind: "blocker",
			message: `Task ${task.id} is reserved by ${task.assignee}.`,
			nextTransition: `Task ${task.id} must become available to ${identity}; Colony must acquire its claim.`,
		});
	}
	if (!task.ready) {
		add({
			code: "native_readiness",
			evidence: ["tracker"],
			kind: "blocker",
			message: `Task ${task.id} is absent from native ready; direct dependencies: ${task.dependencies.map((dep) => `${dep.dependency_type}:${dep.id} (${dep.status})`).join(", ") || "none"}.`,
			nextTransition: `Native Beads must report task ${task.id} ready after its dependency/status conditions are satisfied.`,
		});
	}
	if (task.hitl) {
		add({
			code: "hitl",
			evidence: ["tracker"],
			kind: "blocker",
			message: `Task ${task.id} requires human participation.`,
			nextTransition:
				"The human participation reservation must be resolved explicitly before autonomous dispatch.",
		});
	}
}

function authorityConditions(
	tracker: TrackerFacts,
	checkpoint: NonNullable<RuntimeFacts["checkpoint"]>,
	add: AddDiagnostic,
): void {
	const nativeTasks = tracker.tasks.map(({ id }) => id).toSorted();
	if (
		tracker.identity !== checkpoint.identity ||
		JSON.stringify(nativeTasks) !== JSON.stringify(checkpoint.taskIds.toSorted())
	) {
		add({
			code: "request_authority",
			evidence: ["tracker", "runtime"],
			kind: "disagreement",
			message: "Native identity or related task links differ from the captured request checkpoint.",
			nextTransition:
				"Resolve the request authority mismatch before expecting another launch; the existing checkpoint does not authorize the changed request.",
		});
	}
	if (checkpoint.state === "executing") {
		for (const task of tracker.tasks.filter(
			(item) => item.status !== "closed" && item.assignee !== checkpoint.identity,
		)) {
			add({
				code: "execution_claim",
				evidence: ["tracker", "runtime"],
				kind: "disagreement",
				message: `Executing checkpoint belongs to ${checkpoint.identity}, but task ${task.id} is assigned to ${task.assignee ?? "nobody"}.`,
				nextTransition:
					"An awake pass must observe the changed task authority; a live process observation does not establish a valid native claim.",
			});
		}
	}
}

function runtimeConditions(runtime: RuntimeFacts, add: AddDiagnostic): void {
	const { colony, checkpoint } = runtime;
	if (colony === null) {
		add({
			code: "unregistered",
			evidence: ["runtime"],
			kind: "blocker",
			message: "Selected daemon has no colony registration.",
			nextTransition: "Explicit registration and wake are required for scheduling.",
		});
	} else if (colony.state === "failed") {
		add({
			code: "colony_failed",
			evidence: ["runtime"],
			kind: "blocker",
			message: colony.message,
			nextTransition: "Correct the reported failure and explicitly wake the colony.",
		});
	} else if (colony.state === "asleep") {
		add({
			code: `colony_${colony.state}`,
			evidence: ["runtime"],
			kind: "blocker",
			message: "Colony is asleep; detached workers may continue.",
			nextTransition: "An explicit wake is required for scheduling and reconciliation.",
		});
	}
	if (checkpoint === null) {
		add({
			code: "no_checkpoint",
			evidence: ["runtime"],
			kind: "unknown",
			message: "Daemon has no retained checkpoint for this request.",
			nextTransition:
				"An awake pass must discover the native request before its execution progress is known.",
		});
	} else if (checkpoint.state === "retrying") {
		add({
			code: "retry",
			evidence: ["runtime"],
			kind: "blocker",
			message: `Automatic retry checkpoint: ${checkpoint.message}; retryAt ${checkpoint.retryAt}.`,
			nextTransition:
				"The recorded retry deadline must pass and an awake pass must recheck eligibility, capacity and claims.",
		});
	} else if (checkpoint.state === "claiming" || checkpoint.state === "settling") {
		add({
			code: checkpoint.state,
			evidence: ["runtime"],
			kind: "progress",
			message: `Last checkpoint is ${checkpoint.state}: ${checkpoint.message}`,
			nextTransition: "An awake reconciliation pass must finish the recorded lifecycle transition.",
		});
	}
}
function processConditions(result: Omit<Explanation, "diagnostics">, add: AddDiagnostic): void {
	for (const process of result.processes) {
		for (const diagnostic of processDiagnostics(process, result)) {
			add(diagnostic);
		}
	}
}
// eslint-disable-next-line max-statements -- Compare one fresh ownership observation with the independent native and retained authorities.
function processDiagnostics(
	process: ProcessFact,
	result: Omit<Explanation, "diagnostics">,
): Diagnostic[] {
	const reference = `processes:${process.attemptId}`;
	if (process.evidence.result.kind === "unavailable") {
		return [
			{
				code: "process_unknown",
				evidence: [reference],
				kind: "unknown",
				message: process.evidence.result.message,
				nextTransition:
					"Obtain valid ownership evidence and a verifiable process snapshot before concluding execution has stopped.",
			},
		];
	}
	const observed = process.evidence.result.value;
	const transitions = {
		live: {
			code: "running_observed",
			nextTransition:
				"Owned execution must finish and an awake pass must observe task/worker results; liveness alone does not prove useful work.",
		},
		stopped: {
			code: "stopped_observed",
			nextTransition:
				"An awake pass must reconcile stopped execution with worker results and native task facts.",
		},
	};
	const diagnostics: Diagnostic[] = [
		{
			...transitions[observed],
			evidence: [reference],
			kind: "progress",
			message: `Attempt ${process.attemptId}: owned execution ${observed}.`,
		},
	];
	const runtime = availableValue(result.runtime);
	const attempt = runtime?.attempts.find(({ id }) => id === process.attemptId);
	const recordedLive = attempt?.state === "starting" || attempt?.state === "running";
	if (attempt && recordedLive !== (observed === "live")) {
		diagnostics.push({
			code: "attempt_process",
			evidence: ["runtime", reference],
			kind: "disagreement",
			message: `Attempt checkpoint ${attempt.state} disagrees with fresh ${observed} observation.`,
			nextTransition:
				"An awake pass must reconcile verified execution evidence; inspection does not release its reservation.",
		});
	}
	if (observed === "live" && availableValue(result.tracker)?.status === "closed") {
		diagnostics.push({
			code: "closed_live",
			evidence: ["tracker", reference],
			kind: "disagreement",
			message: "Native request is closed while owned execution is live.",
			nextTransition:
				"An awake pass must perform verified execution cleanup before treating the closure as stopped.",
		});
	}
	return diagnostics;
}

function availableValue<Value>(evidence: Evidence<Value>): Value | null {
	if (evidence.result.kind === "available") {
		return evidence.result.value;
	}
	return null;
}
function unavailableReason(error: unknown): string {
	if (error instanceof DaemonUnavailableError) {
		return "daemon_unavailable";
	}
	return "evidence_unavailable";
}
function labelPublication(spawn: Bead): TrackerFacts["labelPublication"] {
	if (requestLabelsCurrent(spawn)) {
		return "current";
	}
	return "pending";
}
function waitingMessage(decision: ReturnType<typeof eligibility>): string | null {
	if (decision.kind === "waiting") {
		return decision.reason;
	}
	return null;
}
