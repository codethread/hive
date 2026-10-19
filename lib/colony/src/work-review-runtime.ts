/* eslint-disable unicorn/no-null -- Retained native control uses explicit null for absent work. */
import type {
	RepositoryEndpoint,
	SpawnRequest,
	WorkReviewBranch,
	WorkReviewInput,
	WorkReviewRecover,
} from "@hive/shared";
import {
	WORK_REVIEW_BATCH_SIZE,
	readSpawnRequest,
	requestOutcome,
	workReviewCandidateSchema,
} from "@hive/shared";
import {
	WORK_REVIEW_RECOVERY,
	WorkReviewError,
	inspectWorkReview,
	latestWorkReviewReceipt,
	preflightWorkReview,
	requireCancellationContinuation,
	requireFreshWorkReview,
	reserved,
	workReviewFingerprint,
} from "./work-review.ts";
import { getResponse, resolveResponse } from "./response-store.ts";
import type { BeadRecord } from "@hive/beads";
import type { WorkReviewContext } from "./work-review.ts";
import { WorkReviewHealthError } from "./work-review-health.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const RECOVERY_LIMIT = 20;
const PUBLICATION_LIMIT = 2;
const HOUR_MS = 3_600_000;
const NONE = 0;
const ONE = 1;
const text = z.string().min(ONE);
const publicationSchema = z.strictObject({ runId: text.nullable(), requestId: text.nullable() });
const activeSchema = z.strictObject({
	token: text,
	phase: z.enum(["publishing", "submitted", "attention"]),
	candidates: z.array(workReviewCandidateSchema).max(WORK_REVIEW_BATCH_SIZE),
	runId: text.nullable(),
	requestId: text.nullable(),
	detail: z.string(),
});
const recoverySchema = z.strictObject({
	token: text,
	taskId: text,
	requestId: text,
	lineageId: text,
	phase: z.enum(["reserved", "unblocked", "submitted", "attention"]),
	replacementIds: z.array(text),
	reopenedIds: z.array(text),
	detail: z.string(),
});
const branchSchema = z.strictObject({
	nextDue: z.number(),
	cursor: text.nullable(),
	active: activeSchema.nullable(),
	last: publicationSchema.nullable(),
});
export const workReviewControlSchema = z.compile(
	z.strictObject({
		format: z.literal("colony-work-review-control"),
		parent: text,
		kind: text,
		root: text,
		beadsDb: text,
		host: text,
		state: text,
		branches: z.strictObject({ blocked: branchSchema, in_progress: branchSchema }),
		recoveries: z.array(recoverySchema).max(RECOVERY_LIMIT),
	}),
);
type Control = z.infer<typeof workReviewControlSchema>;
export interface WorkReviewContinuation {
	/** Exact native predecessor and captured workflow assignment. */
	request: SpawnRequest;
	/** Native predecessor lineage, including the original stage publication. */
	lineageIds: readonly string[];
	/** Selected tracker and canonical repository, independent of execution cwd. */
	repository: RepositoryEndpoint;
}
export interface WorkReviewContinuationStamp {
	/** Public checkpoint identity within the selected endpoint. */
	checkpoint: string;
	/** Native checkpoint revision sampled by public inspection. */
	savedAt: string;
	/** Definition loaded in the predecessor's original execution checkout. */
	currentHash: string;
}
export interface WorkReviewCommands {
	/** Require readable health with no active tracker alert before native sweep work. */
	assertTracker: (repository: RepositoryEndpoint) => Promise<void>;
	/** Submit a named ordinary workflow with typed input. */
	start: (input: {
		kind: string;
		parent: string;
		input: WorkReviewInput;
		repository: RepositoryEndpoint;
	}) => Promise<{ runId: string; requestId: string }>;
	/** Attach only to an exact confirmed orphan through Bee's native admission. */
	attach: (input: {
		kind: string;
		runId: string;
		repository: RepositoryEndpoint;
	}) => Promise<{ runId: string; requestId: string }>;
	/** Read saved run completion without advancing it. */
	show: (runId: string, repository: RepositoryEndpoint) => Promise<{ status: string }>;
	/** Match native/captured request authority and fresh owning-host stopped-process evidence. */
	stopped: (request: SpawnRequest, repository: RepositoryEndpoint) => Promise<boolean>;
	/** Inspect supported saved assignment without advancing, unlocking or replacing it. */
	continuation: (input: WorkReviewContinuation) => Promise<WorkReviewContinuationStamp>;
	/** Create an ordinary replacement for the exact predecessor. */
	retry: (input: {
		requestId: string;
		resumeCancelled: boolean;
		repository: RepositoryEndpoint;
		actor: string;
		cwd: string | null;
	}) => Promise<{ requestId: string }>;
}
export interface WorkReviewRuntime extends WorkReviewContext {
	/** Private daemon state path used only to bind native control authority. */
	state: string;
	/** Existing public command/process seam. */
	workReview: WorkReviewCommands;
}
export interface WorkReviewClock {
	/** Earliest native work-review read; reset only when this colony is reconstructed. */
	nextDue: number;
}
export class WorkReviewPublicationError extends Error {
	/** Confirmed effects must survive failed public command responses. */
	readonly publication: { runId: string | null; requestId: string | null };
	/** Replacements confirmed before failed retry publication. */
	readonly replacementIds: string[];
	constructor(
		message: string,
		publication: WorkReviewPublicationError["publication"] & { replacementIds: string[] },
		cause: unknown,
	) {
		super(message, { cause });
		this.name = "WorkReviewPublicationError";
		this.publication = { runId: publication.runId, requestId: publication.requestId };
		this.replacementIds = publication.replacementIds;
	}
}

/** The existing serial pass calls this cheaply; native reads occur only at an hourly deadline. */
// eslint-disable-next-line max-statements -- Reserve each due branch before its ordinary public submission.
export async function reconcileWorkReviews(
	runtime: WorkReviewRuntime,
	clock: WorkReviewClock,
): Promise<void> {
	const policy = runtime.config.auto_work_reviews;
	if (policy === null || runtime.now() < clock.nextDue) {
		return;
	}
	await runtime.workReview.assertTracker(runtime.repository);
	let { native, control } = await readWorkReviewControl(runtime);
	for (const branch of ["blocked", "in_progress"] as const) {
		if (runtime.now() >= control.branches[branch].nextDue) {
			// eslint-disable-next-line no-await-in-loop -- Serialize native branch reservations.
			({ native, control } = await reconcileReviewBranch(runtime, { native, control }, branch));
		}
	}
	clock.nextDue = Math.min(control.branches.blocked.nextDue, control.branches.in_progress.nextDue);
}

/** Validate that the recommendation belongs to the current frozen ordinary workflow input. */
// eslint-disable-next-line max-statements -- Verify the frozen batch and current native review-driver lineage together.
export async function authorizeWorkReview(
	runtime: WorkReviewRuntime,
	input: { branch: WorkReviewBranch; token: string; taskId: string; fingerprint: string },
) {
	await runtime.workReview.assertTracker(runtime.repository);
	const { control } = await readWorkReviewControl(runtime);
	const { active } = control.branches[input.branch];
	if (
		!active ||
		active.token !== input.token ||
		!active.candidates.some(
			(candidate) =>
				candidate.taskId === input.taskId && candidate.fingerprint === input.fingerprint,
		)
	) {
		throw new WorkReviewError(
			"unreserved_candidate",
			"Recommendation is outside the active native review reservation",
		);
	}
	if (active.runId === null || active.requestId === null) {
		throw new WorkReviewError(
			"publication_pending",
			"Review driver publication is not yet confirmed; repeat this command after inspecting the review control",
		);
	}
	const scope = trackerScope(runtime.repository, runtime.actor);
	let native = await runtime.beads.show(scope, active.requestId);
	const seen = new Set<string>();
	while (replacementIds(native).length === ONE && seen.size < RECOVERY_LIMIT) {
		seen.add(native.id);
		// eslint-disable-next-line no-await-in-loop -- Follow explicit native replacements for this same review driver.
		native = await runtime.beads.show(scope, replacementIds(native)[NONE]!);
	}
	const reviewer = readSpawnRequest(native);
	if (
		reviewer.host !== runtime.host ||
		reviewer.identity !== runtime.actor ||
		reviewer.assignment.kind !== "driver" ||
		reviewer.assignment.runId !== active.runId ||
		requestOutcome(native) !== "pending"
	) {
		throw new WorkReviewError(
			"foreign_reviewer",
			"Only the current ordinary review driver may record or recover this batch",
		);
	}
	return {
		...active.candidates.find((candidate) => candidate.taskId === input.taskId)!,
		reviewRunId: active.runId,
		reviewRequestId: reviewer.id,
	};
}

/** Consume one lineage budget before unblocking or invoking public Bee retry. */
// eslint-disable-next-line max-statements -- Keep reservation, requeue and retry beside their retained evidence.
export async function recoverWorkReview(runtime: WorkReviewRuntime, input: WorkReviewRecover) {
	await authorizeWorkReview(runtime, input);
	let snapshot = await requireFreshWorkReview(runtime, input);
	const { request } = snapshot;
	const { lineage } = snapshot;
	if (!request || !lineage || request.id !== input.requestId) {
		throw new WorkReviewError(
			"unsupported_recovery",
			"No unique unsuccessful native request maps to this task",
		);
	}
	requireCancellationContinuation(runtime, snapshot, input);
	const finding = latestWorkReviewReceipt(
		snapshot.records.find((record) => record.id === input.taskId)!,
	);
	if (finding?.classification !== "tooling" || finding.fingerprint !== input.fingerprint) {
		throw new WorkReviewError(
			"unclassified_recovery",
			"Recovery requires a native tooling finding matching the candidate fingerprint",
		);
	}
	const scope = trackerScope(runtime.repository, runtime.actor);
	const consumed = snapshot.records.some((record) =>
		record.comments.some((comment) => comment.text.startsWith(WORK_REVIEW_RECOVERY)),
	);
	const read = await readWorkReviewControl(runtime);
	const { native } = read;
	let { control } = read;
	const prior = control.recoveries.find((entry) => entry.lineageId === lineage.id);
	if (consumed || prior) {
		return {
			kind: "work_review_recovery" as const,
			taskId: input.taskId,
			state: "already_attempted" as const,
			replacementIds: prior?.replacementIds ?? replacementIds(request),
			reopenedIds: prior?.reopenedIds ?? [],
			detail:
				prior?.detail ??
				[
					"This native lineage already consumed its automatic allowance; inspect its",
					"recovery receipts and replacement history for caller follow-up.",
				].join(" "),
		};
	}
	control.recoveries = control.recoveries.filter((entry) => entry.phase !== "submitted");
	if (control.recoveries.length >= RECOVERY_LIMIT) {
		throw new WorkReviewError(
			"recovery_capacity",
			"Recovery journal is full of unresolved effects; inspect retained control for caller follow-up",
		);
	}
	const predecessor = readSpawnRequest(request);
	const continuation = {
		request: predecessor,
		lineageIds: snapshot.records
			.filter((record) => record.labels.includes("bee"))
			.map((record) => record.id),
		repository: runtime.repository,
	};
	const supported = await runtime.workReview.continuation(continuation);
	if (!(await runtime.workReview.stopped(predecessor, runtime.repository))) {
		throw new WorkReviewError(
			"process_unverified",
			"Request authority or stopped-process proof is missing or mismatched; inspect colony explain",
		);
	}
	await requireSameContinuation(runtime, continuation, supported);
	snapshot = await requireFreshWorkReview(runtime, input);
	assertRecoveryGates(runtime, snapshot.authorityRecords, input.taskId);
	const authority = { evidence: input.evidence, continuation: input.continuation };
	const recovery: z.infer<typeof recoverySchema> = {
		token: input.token,
		taskId: input.taskId,
		requestId: request.id,
		lineageId: lineage.id,
		phase: "reserved",
		replacementIds: [],
		reopenedIds: [],
		detail: [
			`Inspected checkpoint ${supported.checkpoint} at ${supported.savedAt}, definition ${supported.currentHash}.`,
			"Allowance reserved; interrupted recovery requires caller inspection of",
			"predecessor and confirmed effects before public bee retry.",
		].join(" "),
	};
	control = { ...control, recoveries: [...control.recoveries, recovery] };
	await writeWorkReviewControl(runtime, native, control);
	await runtime.beads.comments.add(
		scope,
		lineage.id,
		`${WORK_REVIEW_RECOVERY} ${JSON.stringify({ ...recovery, ...authority, recordedAt: runtime.now() })}`,
	);
	try {
		await assertRecoveryTracker(runtime, recovery);
		await requireSameContinuation(runtime, continuation, supported);
		snapshot = await requireFreshWorkReview(runtime, input);
		const anchor = readSpawnRequest(request).taskIds[NONE]!;
		const target = snapshot.records.find((record) => record.id === anchor)!;
		if (target.status === "blocked" || target.status === "in_progress") {
			await runtime.beads.update(scope, [target.id], {
				status: "open",
				ifUnchanged: target.updated_at,
			});
			recovery.reopenedIds = [target.id];
			recovery.phase = "unblocked";
			recovery.detail = [
				`Anchor ${target.id} reopened; inspect predecessor ${request.id}`,
				"and its replacements before caller continuation.",
			].join(" ");
			await saveRecovery(runtime, recovery);
		}
		// Public native readiness remains authoritative after the optional tooling-only unblock.
		const ready = await runtime.beads.ready(scope, { limit: NONE });
		const current = await runtime.beads.show(scope, target.id);
		if (
			!ready.some((task) => task.id === current.id) ||
			reserved(runtime, current, readSpawnRequest(request).identity)
		) {
			throw new WorkReviewError(
				"not_ready",
				"Native readiness or reservation prevents continuation after tooling unblock",
			);
		}
		await assertRecoveryTracker(runtime, recovery);
		let branch: WorkReviewBranch | "open" = input.branch;
		if (recovery.reopenedIds.includes(input.taskId)) {
			branch = "open";
		}
		if (!(await runtime.workReview.stopped(predecessor, runtime.repository))) {
			throw new WorkReviewError(
				"process_unverified",
				"Request authority or stopped-process proof changed; inspect colony explain and recovery effects",
			);
		}
		await requireSameContinuation(runtime, continuation, supported);
		await requireRecoverySnapshot(runtime, {
			input,
			branch,
			snapshot,
			reopenedIds: recovery.reopenedIds,
		});
		const result = await runtime.workReview.retry({
			requestId: request.id,
			resumeCancelled: requestOutcome(request) === "cancelled",
			repository: runtime.repository,
			actor: runtime.actor,
			cwd: readSpawnRequest(request).recipe.cwd,
		});
		recovery.replacementIds = [result.requestId];
		const replacement = readSpawnRequest(await runtime.beads.show(scope, result.requestId));
		if (
			JSON.stringify(replacement.assignment) !==
			JSON.stringify(readSpawnRequest(request).assignment)
		) {
			throw new WorkReviewError(
				"assignment_changed",
				"Replacement did not preserve the saved run/stage assignment",
			);
		}
		recovery.phase = "submitted";
	} catch (error) {
		if (error instanceof WorkReviewHealthError) {
			throw error;
		}
		if (error instanceof WorkReviewPublicationError) {
			recovery.replacementIds = error.replacementIds;
		}
		await assertRecoveryTracker(runtime, recovery);
		recovery.phase = "attention";
		recovery.detail = [
			`${String(error)}; inspect predecessor ${request.id},`,
			"reopened anchors and replacement IDs before caller continuation.",
		].join(" ");
		const current = await runtime.beads.show(scope, request.id);
		recovery.replacementIds = replacementIds(current);
	}
	await assertRecoveryTracker(runtime, recovery);
	await saveRecovery(runtime, recovery);
	await assertRecoveryTracker(runtime, recovery);
	await runtime.beads.comments.add(
		scope,
		lineage.id,
		`${WORK_REVIEW_RECOVERY} ${JSON.stringify({ ...recovery, ...authority, recordedAt: runtime.now() })}`,
	);
	return {
		kind: "work_review_recovery" as const,
		taskId: input.taskId,
		state: recovery.phase,
		replacementIds: recovery.replacementIds,
		reopenedIds: recovery.reopenedIds,
		detail: recovery.detail,
	};
}

// eslint-disable-next-line max-statements -- Load and verify one native endpoint-bound control record.
export async function readWorkReviewControl(
	runtime: WorkReviewRuntime,
): Promise<{ native: BeadRecord; control: Control }> {
	const policy = runtime.config.auto_work_reviews;
	if (policy === null) {
		throw new WorkReviewError("disabled", "Automatic work reviews are disabled");
	}
	const native = await runtime.beads.show(
		trackerScope(runtime.repository, runtime.actor),
		policy.parent,
	);
	if (
		native.status === "closed" ||
		native.status === "blocked" ||
		native.labels.includes("system") ||
		reserved(runtime, native, "sys-colony")
	) {
		throw new WorkReviewError(
			"reserved_control",
			"Work-review control is closed, blocked or reserved",
		);
	}
	let control: Control = {
		format: "colony-work-review-control",
		...policy,
		...runtime.repository,
		host: runtime.host,
		state: runtime.state,
		branches: {
			blocked: { nextDue: NONE, cursor: null, active: null, last: null },
			in_progress: { nextDue: NONE, cursor: null, active: null, last: null },
		},
		recoveries: [],
	};
	if (native.notes !== "") {
		control = workReviewControlSchema.parse(JSON.parse(native.notes), { jitless: true });
	}
	if (
		control.parent !== policy.parent ||
		control.kind !== policy.kind ||
		control.root !== runtime.repository.root ||
		control.beadsDb !== runtime.repository.beadsDb ||
		control.host !== runtime.host ||
		control.state !== runtime.state
	) {
		throw new WorkReviewError(
			"foreign_control",
			"Work-review control belongs to another endpoint, host, state or policy",
		);
	}
	return { native, control };
}

// --- Private functions ---
async function requireRecoverySnapshot(
	runtime: WorkReviewRuntime,
	{
		input,
		branch,
		snapshot,
		reopenedIds,
	}: {
		input: WorkReviewRecover;
		branch: WorkReviewBranch | "open";
		snapshot: Awaited<ReturnType<typeof requireFreshWorkReview>>;
		reopenedIds: string[];
	},
): Promise<void> {
	const current = await inspectWorkReview(runtime, {
		taskId: input.taskId,
		branch,
		requestId: input.requestId,
	});
	if (
		!current ||
		current.request?.id !== input.requestId ||
		recoveryFingerprint(current.records, snapshot.records, reopenedIds) !== input.fingerprint
	) {
		throw new WorkReviewError(
			"stale_candidate",
			"Native continuation evidence changed after the recovery reservation",
		);
	}
	assertRecoveryGates(runtime, current.authorityRecords, input.taskId);
}

async function requireSameContinuation(
	runtime: WorkReviewRuntime,
	input: WorkReviewContinuation,
	expected: WorkReviewContinuationStamp,
): Promise<void> {
	const current = await runtime.workReview.continuation(input);
	if (
		current.checkpoint !== expected.checkpoint ||
		current.savedAt !== expected.savedAt ||
		current.currentHash !== expected.currentHash
	) {
		throw new WorkReviewError(
			"stale_workflow",
			`Saved workflow ${input.request.assignment.runId} changed; ` +
				"inspect its checkpoint, definition and assignment before caller continuation",
		);
	}
}
async function assertRecoveryTracker(
	runtime: WorkReviewRuntime,
	recovery: z.infer<typeof recoverySchema>,
): Promise<void> {
	try {
		await runtime.workReview.assertTracker(runtime.repository);
	} catch (error) {
		throw new WorkReviewHealthError(recovery, error);
	}
}
// eslint-disable-next-line max-statements -- Persist the branch deadline and reservation before its single submission.
async function reconcileReviewBranch(
	runtime: WorkReviewRuntime,
	state: { native: BeadRecord; control: Control },
	branch: WorkReviewBranch,
) {
	let { native, control } = state;
	let saved = control.branches[branch];
	if (saved.active !== null) {
		saved = await settleReview(runtime, saved);
	}
	saved = { ...saved, nextDue: runtime.now() + HOUR_MS };
	control.branches[branch] = saved;
	native = await writeWorkReviewControl(runtime, native, control);
	if (saved.active !== null) {
		return { native, control };
	}
	const preflight = await preflightWorkReview(runtime, branch, saved.cursor);
	if (preflight.candidates.length === NONE) {
		return { native, control };
	}
	const active: z.infer<typeof activeSchema> = {
		token: crypto.randomUUID(),
		phase: "publishing",
		candidates: preflight.candidates,
		runId: null,
		requestId: null,
		detail: "",
	};
	control.branches[branch] = { ...saved, cursor: preflight.nextCursor, active };
	native = await writeWorkReviewControl(runtime, native, control);
	await runtime.workReview.assertTracker(runtime.repository);
	try {
		const publication = await runtime.workReview.start({
			...runtime.config.auto_work_reviews!,
			repository: runtime.repository,
			input: {
				branch,
				token: active.token,
				controlParent: control.parent,
				candidates: active.candidates,
			},
		});
		active.phase = "submitted";
		Object.assign(active, publication);
	} catch (error) {
		active.phase = "attention";
		active.detail = String(error);
		if (error instanceof WorkReviewPublicationError) {
			Object.assign(active, error.publication);
		}
	}
	try {
		await runtime.workReview.assertTracker(runtime.repository);
	} catch (error) {
		throw new WorkReviewPublicationError(
			`Review ${active.token} paused after publication; inspect confirmed run/request IDs after tracker recovery`,
			{ runId: active.runId, requestId: active.requestId, replacementIds: [] },
			error,
		);
	}
	// Read again because the dispatched workflow can publish decisions immediately.
	({ native, control } = await readWorkReviewControl(runtime));
	control.branches[branch].active = active;
	native = await writeWorkReviewControl(runtime, native, control);
	return { native, control };
}

async function writeWorkReviewControl(
	runtime: WorkReviewRuntime,
	native: BeadRecord,
	control: Control,
): Promise<BeadRecord> {
	const scope = trackerScope(runtime.repository, runtime.actor);
	const notes = JSON.stringify(control);
	await runtime.beads.update(scope, [native.id], {
		notes,
		ifUnchanged: native.updated_at,
		force: true,
	});
	const current = await runtime.beads.show(scope, native.id);
	if (current.notes !== notes) {
		throw new WorkReviewError(
			"control_changed",
			"Native review control changed after conditional publication",
		);
	}
	return current;
}
// eslint-disable-next-line max-statements -- Verify publication, request, run and delivery before releasing the branch.
async function settleReview(
	runtime: WorkReviewRuntime,
	saved: z.infer<typeof branchSchema>,
): Promise<z.infer<typeof branchSchema>> {
	let active = saved.active!;
	if (active.phase !== "submitted") {
		active = await inspectReviewPublication(runtime, active);
		if (active.phase !== "submitted") {
			return { ...saved, active };
		}
	}
	const native = await runtime.beads.show(
		trackerScope(runtime.repository, runtime.actor),
		active.requestId!,
	);
	const successors = replacementIds(native);
	if (successors.length === ONE) {
		return { ...saved, active: { ...active, requestId: successors[NONE]! } };
	}
	if (successors.length > ONE) {
		return {
			...saved,
			active: { ...active, phase: "attention", detail: "Ambiguous review driver replacements" },
		};
	}
	if (requestOutcome(native) !== "succeeded") {
		if (requestOutcome(native) !== "pending") {
			active = {
				...active,
				phase: "attention",
				detail: `Review ${native.id} failed; inspect bee status before retrying this saved run.`,
			};
		}
		return { ...saved, active };
	}
	const run = await runtime.workReview.show(active.runId!, runtime.repository);
	if (run.status !== "done") {
		return { ...saved, active };
	}
	const context = { beads: runtime.beads, scope: trackerScope(runtime.repository, runtime.actor) };
	const delivery = await resolveResponse(context, { taskId: active.runId!, requestId: native.id });
	if (delivery.state !== "available") {
		return {
			...saved,
			active: {
				...active,
				phase: "attention",
				detail: `Delivery is ${delivery.state}; inspect the existing response before another review.`,
			},
		};
	}
	const response = await getResponse(context, delivery.responseIds[NONE]);
	if (response.author !== readSpawnRequest(native).identity || response.requestId !== native.id) {
		throw new WorkReviewError(
			"invalid_delivery",
			"Review response does not match its current native driver",
		);
	}
	return { ...saved, active: null, last: { runId: active.runId, requestId: active.requestId } };
}
// eslint-disable-next-line max-statements -- Inspect confirmed effects before the public orphan-only attachment.
async function inspectReviewPublication(
	runtime: WorkReviewRuntime,
	original: z.infer<typeof activeSchema>,
) {
	const active = { ...original };
	const scope = trackerScope(runtime.repository, runtime.actor);
	if (active.runId === null && active.requestId === null) {
		const runs = await runtime.beads.list(scope, {
			descriptionContains: active.token,
			excludeLabels: ["system"],
			all: true,
			limit: PUBLICATION_LIMIT,
		});
		if (runs.issues.length !== ONE || runs.has_more) {
			return {
				...active,
				phase: "attention" as const,
				detail: "Uncertain workflow publication; inspect retained token before another submission",
			};
		}
		const run = await runtime.beads.show(scope, runs.issues[NONE]!.id);
		if (
			!run.dependencies.some(
				(edge) =>
					edge.dependency_type === "parent-child" &&
					edge.id === runtime.config.auto_work_reviews!.parent,
			)
		) {
			throw new WorkReviewError(
				"foreign_publication",
				"Review token resolved outside its control parent",
			);
		}
		active.runId = run.id;
	}
	if (active.runId !== null && active.requestId === null) {
		const run = await runtime.beads.show(scope, active.runId);
		assertReviewRun(runtime, run, active.token);
		const ids = run.dependents
			.filter((edge) => edge.dependency_type === "related")
			.map((edge) => edge.id);
		let requests: { id: string }[] = [];
		if (ids.length > NONE) {
			const page = await runtime.beads.list(scope, {
				ids,
				labels: ["system", "bee"],
				all: true,
				limit: PUBLICATION_LIMIT,
			});
			if (page.has_more) {
				throw new WorkReviewError(
					"ambiguous_publication",
					"Review driver history exceeds its publication bound",
				);
			}
			requests = page.issues;
		}
		if (requests.length > ONE) {
			return {
				...active,
				phase: "attention" as const,
				detail: "Ambiguous review driver history; inspect native requests",
			};
		}
		if (requests.length === ONE) {
			active.requestId = requests[NONE]!.id;
		} else {
			const publication = await runtime.workReview.attach({
				kind: runtime.config.auto_work_reviews!.kind,
				runId: run.id,
				repository: runtime.repository,
			});
			Object.assign(active, publication);
		}
	}
	if (active.requestId !== null) {
		const request = readSpawnRequest(await runtime.beads.show(scope, active.requestId));
		if (
			request.host !== runtime.host ||
			request.assignment.kind !== "driver" ||
			(active.runId !== null && request.assignment.runId !== active.runId)
		) {
			throw new WorkReviewError(
				"foreign_publication",
				"Review driver has mismatched host or assignment",
			);
		}
		assertReviewRun(
			runtime,
			await runtime.beads.show(scope, request.assignment.runId),
			active.token,
		);
		return { ...active, phase: "submitted" as const, runId: request.assignment.runId };
	}
	return active;
}

function assertReviewRun(runtime: WorkReviewRuntime, run: BeadRecord, token: string): void {
	if (
		!run.description.includes(token) ||
		!run.dependencies.some(
			(edge) =>
				edge.dependency_type === "parent-child" &&
				edge.id === runtime.config.auto_work_reviews!.parent,
		)
	) {
		throw new WorkReviewError(
			"foreign_publication",
			"Review run no longer belongs to its retained token and control parent",
		);
	}
}

function recoveryFingerprint(
	current: BeadRecord[],
	original: BeadRecord[],
	reopened: string[],
): string {
	const normalized: BeadRecord[] = [];
	for (const record of current) {
		let restored = record;
		if (reopened.includes(record.id)) {
			const { status } = original.find((previous) => previous.id === record.id)!;
			restored = { ...record, status };
		}
		normalized.push(restored);
	}
	return workReviewFingerprint(normalized);
}

function assertRecoveryGates(
	runtime: WorkReviewRuntime,
	records: BeadRecord[],
	taskId: string,
): void {
	const ordinary = records.filter(
		(record) => !record.labels.includes("system") && record.status !== "closed",
	);
	if (ordinary.some((record) => record.id !== taskId && record.status === "blocked")) {
		throw new WorkReviewError("blocked_ancestor", "Another source or prerequisite remains blocked");
	}
	for (const record of ordinary) {
		for (const edge of record.dependencies) {
			if (
				["blocks", "conditional-blocks", "waits-for"].includes(edge.dependency_type) &&
				records.find((target) => target.id === edge.id)?.status !== "closed"
			) {
				throw new WorkReviewError(
					"unresolved_dependency",
					"A native prerequisite still prevents continuation",
				);
			}
		}
		if (reserved(runtime, record)) {
			throw new WorkReviewError("reserved_source", "Source or ancestor continuation is reserved");
		}
	}
}
async function saveRecovery(
	runtime: WorkReviewRuntime,
	recovery: z.infer<typeof recoverySchema>,
): Promise<void> {
	const { native, control } = await readWorkReviewControl(runtime);
	control.recoveries = control.recoveries.map((entry) => {
		if (entry.lineageId === recovery.lineageId) {
			return recovery;
		}
		return entry;
	});
	await writeWorkReviewControl(runtime, native, control);
}
function replacementIds(record: BeadRecord): string[] {
	return record.dependents
		.filter((edge) => edge.dependency_type === "supersedes")
		.map((edge) => edge.id);
}
