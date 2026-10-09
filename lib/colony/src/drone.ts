/* eslint-disable unicorn/no-null -- Durable review checkpoints distinguish pending decisions and launch failures without receipts. */
import type { BeesConfig, RepositoryEndpoint } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Attempt-local immutable reports and execution artifacts.
import { dirname, join } from "node:path";
import {
	launchReceiptSchema,
	startSupervisor,
	workerReceiptSchema,
	writeReceipt,
} from "./launch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Atomic single-submission report transport.
import { link, readFile, stat, unlink } from "node:fs/promises";
import { observeExecution, resumeExecution, stopExecution } from "./processes.ts";
import { publishObservation, readStdoutActivity } from "./observations.ts";
import type { LaunchReceipt } from "./launch.ts";
import type { RequestRecord } from "./request.ts";
import type { Store } from "./store.ts";
import { readDroneAuthority } from "./store.ts";
import { renderFormula } from "@hive/shared";
import { z } from "zod";

export const INACTIVITY_INTERVAL_MS = 900_000;
export const DRONE_RUNTIME_MS = 300_000;
const NONEMPTY = 1;
const decisionSchema = z.strictObject({
	at: z.number(),
	detail: z.string(),
	kind: z.enum([
		"active",
		"inactive",
		"launch_failed",
		"exited_without_verdict",
		"timeout",
		"cancelled",
	]),
});
const reviewFields = {
	/** Absolute maximum runtime, enforced by the detached supervisor too. */
	deadline: z.number(),
	/** Immutable review identity; also its execution directory name. */
	id: z.string().uuid(),
	/** Inspected spawn, independent of review execution identity. */
	spawnId: z.string(),
	/** Reservation time, never a stdout heartbeat. */
	startedAt: z.number(),
	/** Exact inspected execution; replacements have different authority. */
	targetAttemptId: z.string(),
};
const decidedFields = {
	...reviewFields,
	decision: decisionSchema,
	launched: z.boolean(),
	receipt: launchReceiptSchema.nullable(),
};
export const droneReviewSchema = z.discriminatedUnion("phase", [
	z.strictObject({
		...reviewFields,
		decision: z.null(),
		launched: z.literal(false),
		phase: z.literal("reserved"),
		receipt: launchReceiptSchema.nullable(),
	}),
	z.strictObject({
		...reviewFields,
		decision: z.null(),
		launched: z.literal(true),
		phase: z.literal("reviewing"),
		receipt: launchReceiptSchema,
	}),
	z.strictObject({ ...decidedFields, phase: z.literal("decided") }),
	z.strictObject({ ...decidedFields, phase: z.literal("finished") }),
]);
export const droneContextSchema = z.strictObject({
	deadline: z.number(),
	reviewId: z.string().uuid(),
	targetAttemptId: z.string(),
	targetSpawnId: z.string(),
});
const verdictSchema = z.strictObject({
	attemptId: z.string().uuid(),
	reportedAt: z.number(),
	reviewId: z.string().uuid(),
	spawnId: z.string().min(NONEMPTY),
	targetAttemptId: z.string(),
	token: z.string().uuid(),
	verdict: z.enum(["active", "inactive"]),
});
export type DroneReview = z.infer<typeof droneReviewSchema>;
type Verdict = z.infer<typeof verdictSchema>;
interface ReviewRuntime {
	/** Canonical repository and selected tracker authority. */
	repository: RepositoryEndpoint;
	/** Durable current-attempt and review authority. */
	store: Store;
	/** Canonical named drone kind and invocation formulas. */
	config: BeesConfig;
	/** Clock injection for deterministic deadline and deferral verification. */
	now?: () => number;
}
export interface DroneReportResult {
	/** Submission is durable; Colony still validates current authority. */
	kind: "drone_verdict_submitted";
	/** Inspected request, never a replacement. */
	requestId: string;
	/** Exact inspected execution. */
	attemptId: string;
	/** One-shot inspection identity. */
	reviewId: string;
}

/** Silence and an active verdict set independent review clocks; neither fabricates stdout. */
export function inactivityReviewDue(input: {
	startedAt: number;
	lastOutputAt: string | null;
	previous: DroneReview | undefined;
	now: number;
}): boolean {
	const { startedAt, lastOutputAt, previous, now } = input;
	if (previous && (previous.phase !== "finished" || previous.decision.kind !== "active")) {
		return false;
	}
	let output = startedAt;
	if (lastOutputAt !== null) {
		output = Date.parse(lastOutputAt);
	}
	let deferred = startedAt;
	if (previous?.decision?.kind === "active") {
		deferred = previous.decision.at;
	}
	return now >= Math.max(output, deferred) + INACTIVITY_INTERVAL_MS;
}

/** Reconcile one current target; drones never enter the task-request scheduler or claim work. */
// eslint-disable-next-line max-statements -- Keep the one-shot durable review checkpoints and their ordered effects together.
export async function reviewInactivity(
	runtime: ReviewRuntime,
	record: RequestRecord,
	target: LaunchReceipt,
): Promise<string | undefined> {
	const { repository, store, config } = runtime;
	const now = runtime.now ?? Date.now;
	let review = store.latestDroneReview(repository.root, target.id);
	if (!review || (review.phase === "finished" && review.decision?.kind === "active")) {
		if (config.inactivity_drone === null) {
			return;
		}
		const lastOutputAt = await readStdoutActivity(target.directory);
		if (
			!inactivityReviewDue({
				lastOutputAt,
				now: now(),
				previous: review,
				startedAt: Date.parse(target.createdAt),
			})
		) {
			return;
		}
		review = await launchReview(runtime, target, now());
	}
	if (review.phase === "reserved") {
		// Permission is granted only after the reviewing checkpoint; recovery never grants it here.
		review = {
			...review,
			decision: {
				at: now(),
				detail: "Inspection never occurred: preparation interrupted before execution permission",
				kind: "launch_failed",
			},
			phase: "decided",
		};
		store.saveDroneReview(repository.root, review);
	}
	if (review.phase === "reviewing") {
		review = await decideReview(review, now());
		store.saveDroneReview(repository.root, review);
	}
	if (review.phase === "decided") {
		review = await finishReview(runtime, review);
	}
	if (
		review.decision &&
		review.decision.kind !== "active" &&
		review.decision.kind !== "cancelled"
	) {
		return `Inactivity drone ${review.decision.kind}; attempt ${record.context.attemptId}; review ${review.id}; ${review.decision.detail}`;
	}
	return undefined;
}

/** Stop an outstanding review before target settlement; checkpoint first for safe replay. */
export async function cancelDroneReview(
	runtime: ReviewRuntime,
	targetAttemptId: string,
): Promise<void> {
	const { repository, store } = runtime;
	const review = store.latestDroneReview(repository.root, targetAttemptId);
	if (!review || review.phase === "finished") {
		return;
	}
	const cancelled: DroneReview = {
		...review,
		decision: {
			at: (runtime.now ?? Date.now)(),
			detail: "Target execution settling",
			kind: "cancelled",
		},
		phase: "decided",
	};
	store.saveDroneReview(repository.root, cancelled);
	await finishReview(runtime, cancelled);
}

/** A drone submits once using injected context and recorded current target/review authority. */
// eslint-disable-next-line max-statements -- Validate current authority before atomically publishing exactly one report.
export async function submitDroneVerdict(
	spawnId: string,
	verdict: string,
	env: Record<string, string | undefined> = process.env,
): Promise<DroneReportResult> {
	const report = verdictSchema.parse({
		attemptId: env["HIVE_ATTEMPT_ID"],
		reportedAt: Date.now(),
		reviewId: env["HIVE_DRONE_REVIEW_ID"],
		spawnId,
		targetAttemptId: env["HIVE_DRONE_TARGET_ATTEMPT_ID"],
		token: env["HIVE_ATTEMPT_TOKEN"],
		verdict,
	});
	const state = z.string().min(NONEMPTY).parse(env["HIVE_COLONY_STATE"]);
	const authority = readDroneAuthority(state, report.reviewId);
	assertVerdictAuthority(report, { ...authority, now: Date.now() });
	const path = join(authority.review.receipt!.directory, "verdict.json");
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await Bun.write(temporary, JSON.stringify(report));
	try {
		await link(temporary, path);
	} finally {
		await unlink(temporary);
	}
	// Publication may cross the deadline while awaiting filesystem I/O; retained late evidence is rejected.
	assertVerdictAuthority(report, { ...authority, now: Date.now() });
	return {
		attemptId: report.targetAttemptId,
		kind: "drone_verdict_submitted",
		requestId: report.spawnId,
		reviewId: report.reviewId,
	};
}

/** Validate immutable provenance, current target and deadline at each report boundary. */
export function assertVerdictAuthority(
	report: Verdict,
	{ review, request, now }: { review: DroneReview; request: RequestRecord; now: number },
): void {
	if (
		review.phase !== "reviewing" ||
		review.decision !== null ||
		request.state !== "executing" ||
		request.id !== review.spawnId ||
		request.context.attemptId !== review.targetAttemptId ||
		report.reviewId !== review.id ||
		report.spawnId !== review.spawnId ||
		report.targetAttemptId !== review.targetAttemptId ||
		report.attemptId !== review.receipt.id ||
		report.token !== review.receipt.token ||
		report.reportedAt < review.startedAt ||
		report.reportedAt >= review.deadline ||
		now >= review.deadline
	) {
		throw new Error("Drone verdict is stale, late, or does not match current review authority");
	}
}

// --- Review effects ---
// eslint-disable-next-line max-statements -- Reserve before launch, then record authority before granting execution permission.
async function launchReview(
	runtime: ReviewRuntime,
	target: LaunchReceipt,
	now: number,
): Promise<DroneReview> {
	const { repository, store, config } = runtime;
	let review: DroneReview = {
		deadline: now + DRONE_RUNTIME_MS,
		decision: null,
		id: crypto.randomUUID(),
		launched: false,
		phase: "reserved",
		receipt: null,
		spawnId: target.spawnId,
		startedAt: now,
		targetAttemptId: target.id,
	};
	store.saveDroneReview(repository.root, review);
	let supervisorPid: number | null = null;
	try {
		const receipt = droneReceipt(target, config, review);
		review = { ...review, receipt };
		store.saveDroneReview(repository.root, review);
		await writeReceipt(receipt);
		await Bun.write(
			join(receipt.directory, "drone.json"),
			JSON.stringify({
				deadline: review.deadline,
				reviewId: review.id,
				targetAttemptId: target.id,
				targetSpawnId: target.spawnId,
			}),
		);
		await startSupervisor(receipt, dirname(target.directory), (pid) => {
			supervisorPid = pid;
		});
	} catch (error) {
		review = {
			...review,
			decision: {
				at: now,
				detail: `Inspection never occurred: ${String(error)}`,
				kind: "launch_failed",
			},
			launched: supervisorPid !== null,
			phase: "decided",
		};
		store.saveDroneReview(repository.root, review);
		return review;
	}
	// Record authority before granting permission: even an immediate report sees the current review.
	review = {
		...review,
		decision: null,
		launched: true,
		phase: "reviewing",
		receipt: review.receipt!,
	};
	store.saveDroneReview(repository.root, review);
	// Ownership errors remain loud and cannot be reclassified as ordinary drone failures.
	await resumeExecution(review.receipt, (supervisor) => {
		if (supervisor.pid !== supervisorPid) {
			throw new Error("Drone supervisor handoff does not match the launched child");
		}
	});
	await publishObservation(
		repository,
		target.spawnId,
		`running: inactivity review ${review.id}; target attempt ${target.id}; deadline ${new Date(review.deadline).toISOString()}; logs ${review.receipt!.directory}`,
	);
	return review;
}

// eslint-disable-next-line max-statements -- Reconcile verdict, exit evidence and deadline in policy precedence order.
async function decideReview(
	review: Extract<DroneReview, { phase: "reviewing" }>,
	now: number,
): Promise<DroneReview> {
	const { receipt } = review;
	const verdict = await readVerdict(review);
	if (verdict !== undefined) {
		return {
			...review,
			decision: { at: now, detail: `Inspected ${verdict}`, kind: verdict },
			phase: "decided",
		};
	}
	const workerPath = join(receipt.directory, "worker.json");
	if (await Bun.file(workerPath).exists()) {
		const result = workerReceiptSchema.parse(JSON.parse(await readFile(workerPath, "utf8")));
		if (result.token !== receipt.token) {
			throw new Error("Drone worker token does not match review authority");
		}
		const metadata = await stat(workerPath);
		const endedAt = metadata.mtimeMs;
		if (result.kind === "failed" && endedAt < review.deadline) {
			return {
				...review,
				decision: {
					at: now,
					detail: `Drone launch failed: ${result.message}`,
					kind: "launch_failed",
				},
				phase: "decided",
			};
		}
		if (result.kind === "exited" && endedAt < review.deadline) {
			return {
				...review,
				decision: {
					at: now,
					detail: `Drone exited ${result.code} without a valid verdict`,
					kind: "exited_without_verdict",
				},
				phase: "decided",
			};
		}
	}
	if (now >= review.deadline) {
		return {
			...review,
			decision: {
				at: now,
				detail: "Five-minute deadline reached without a valid verdict",
				kind: "timeout",
			},
			phase: "decided",
		};
	}
	const observed = await observeExecution(receipt);
	if (observed.kind === "stopped") {
		return {
			...review,
			decision: {
				at: now,
				detail: "Drone stopped without a valid verdict",
				kind: "exited_without_verdict",
			},
			phase: "decided",
		};
	}
	return review;
}

// eslint-disable-next-line max-statements -- Parse external report data before matching current review provenance.
async function readVerdict(
	review: Extract<DroneReview, { phase: "reviewing" }>,
): Promise<"active" | "inactive" | undefined> {
	const path = join(review.receipt.directory, "verdict.json");
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return undefined;
	}
	let data: unknown = undefined;
	try {
		data = await file.json();
	} catch (error) {
		if (!(error instanceof SyntaxError)) {
			throw error;
		}
		return undefined;
	}
	const parsed = verdictSchema.safeParse(data);
	if (!parsed.success) {
		return undefined;
	}
	const report = parsed.data;
	const metadata = await stat(path);
	// Timely durable reports survive sleep; stale/late/invalid artifacts never count as verdicts.
	if (
		report.reviewId !== review.id ||
		report.attemptId !== review.receipt.id ||
		report.token !== review.receipt.token ||
		report.spawnId !== review.spawnId ||
		report.targetAttemptId !== review.targetAttemptId ||
		report.reportedAt < review.startedAt ||
		report.reportedAt >= review.deadline ||
		metadata.ctimeMs >= review.deadline
	) {
		return undefined;
	}
	return report.verdict;
}

async function finishReview(
	{ repository, store }: ReviewRuntime,
	review: DroneReview,
): Promise<DroneReview> {
	/* An interrupted reservation never received permission. Stop an observed waiter using its
	 * verified handoff; a handoff published later can only wait until its supervisor deadline. */
	if (
		review.receipt !== null &&
		(review.launched ||
			(await Bun.file(join(review.receipt.directory, "supervisor.json")).exists()))
	) {
		await stopExecution(review.receipt);
	}
	await publishObservation(
		repository,
		review.spawnId,
		`running: inactivity drone ${review.decision!.kind}; target attempt ${review.targetAttemptId}; review ${review.id}; ${review.decision!.detail}`,
	);
	const finished: DroneReview = { ...review, decision: review.decision!, phase: "finished" };
	store.saveDroneReview(repository.root, finished);
	return finished;
}

function droneReceipt(
	target: LaunchReceipt,
	config: BeesConfig,
	review: DroneReview,
): LaunchReceipt {
	const kind = config.inactivity_drone!;
	const defaults = config.kinds[kind];
	if (!defaults) {
		throw new Error(`No inactivity drone kind named ${kind}`);
	}
	const formula = config.formulas[defaults.harness];
	if (!formula) {
		throw new Error(`No formula named ${defaults.harness} for inactivity drone ${kind}`);
	}
	const prompt = `${defaults.prompt}\n\nInspect only spawn ${target.spawnId}, execution attempt ${target.id}, review ${review.id}. Deadline: ${new Date(review.deadline).toISOString()}. Target logs and process ownership evidence: ${target.directory} (stdout.log, stderr.log, ownership.json, worker.json). Consider legitimate long-running waits; PID existence or stdout silence alone does not prove progress or inactivity. Report exactly one verdict with: bee report ${target.spawnId} active|inactive. Do not close tasks, claim work, signal processes, assign lifecycle states, launch another drone, or use bee finish. Colony owns all lifecycle decisions.`;
	const recipe = {
		cwd: target.cwd,
		effort: defaults.effort,
		harness: defaults.harness,
		kind,
		model: defaults.model,
		prompt,
		system_prompt: defaults.system_prompt,
	};
	return {
		...target,
		attemptNumber: 1,
		createdAt: new Date(review.startedAt).toISOString(),
		directory: join(dirname(target.directory), review.id),
		formula,
		id: review.id,
		identity: `drone-${review.id}`,
		invocation: renderFormula(formula, recipe, "headless"),
		// The target's earlier dispatch revision does not describe this current auxiliary invocation.
		policyRevisionId: null,
		recipe,
		taskIds: [],
		token: crypto.randomUUID(),
	};
}
