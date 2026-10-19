/* eslint-disable unicorn/no-null -- Native fixture controls retain explicit empty fields. */
import {
	WORK_REVIEW_RECEIPT,
	WORK_REVIEW_RECOVERY,
	WorkReviewError,
	workReviewFingerprint,
} from "./work-review.ts";
import { beforeTrackerWrite, createSpawn, createTask } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { failedWork, seedWorkReview, workReviewFixture } from "./work-review.test-support.ts";
import { WorkReviewHealthError } from "./work-review-health.ts";
import type { WorkReviewRecover } from "@hive/shared";
import { recoverWorkReview } from "./work-review-runtime.ts";

const NONE = 0;
const ONE = 1;
const HOUR = 3_600_000;
const BEFORE_UNBLOCK = 2;
const BEFORE_RETRY = 3;

// eslint-disable-next-line max-statements -- Prepare continuation and tooling receipts before recovery scenarios.
async function prepared(
	options: Parameters<typeof failedWork>[typeof ONE] & {
		assignedSource?: true;
		closedPrerequisite?: true;
		stage?: true;
		continuation?: "missing" | "assertion" | "stale" | "unrelated" | "unlinked" | "forged-author";
	} = {},
) {
	const fixture = await workReviewFixture();
	const target = await failedWork(fixture, options);
	if (options.stage) {
		const native = await fixture.beads.show(fixture.scope, target.requestId);
		const recipe = JSON.parse(native.description);
		recipe.assignment = { kind: "stage", runId: target.source, stageId: target.anchor };
		await fixture.beads.update(fixture.scope, [native.id], { description: JSON.stringify(recipe) });
	}
	if (options.assignedSource) {
		await fixture.beads.update(fixture.scope, [target.source], { assignee: "previous-worker" });
	}
	const continuation = await cancellationEvidence(fixture, target, options);
	const additional: string[] = [];
	if (options.closedPrerequisite) {
		const retiredScope = await createTask(fixture, { assignee: "ct" });
		const prerequisite = await createTask(fixture, {
			assignee: "retired-worker",
			parent: retiredScope,
		});
		await fixture.beads.close(fixture.scope, prerequisite, { reason: "Prerequisite completed" });
		await fixture.beads.dep.add(fixture.scope, target.source, prerequisite, "blocks");
		additional.push(prerequisite);
	}
	const records = await fixture.beads.showMany(fixture.scope, [
		...new Set([target.source, target.anchor, target.requestId, ...additional]),
	]);
	let branch = "in_progress" as "blocked" | "in_progress";
	if (options.status === "blocked") {
		branch = "blocked";
	}
	const candidate = {
		taskId: target.source,
		fingerprint: workReviewFingerprint(records),
		requestId: target.requestId,
	};
	const token = `review-${target.requestId}`;
	const publication = await seedWorkReview(fixture, {
		branch,
		token,
		controlParent: fixture.parent,
		candidates: [candidate],
	});
	const decision = {
		branch,
		token,
		taskId: candidate.taskId,
		fingerprint: candidate.fingerprint,
		classification: "tooling" as const,
		diagnosis: "Tooling pause cleared",
		evidence: ["tool --version: success"],
		nextAction: "Retry saved assignment",
	};
	const receiptData = {
		...decision,
		reviewRunId: publication.runId,
		reviewRequestId: publication.requestId,
		recordedAt: fixture.time.now,
	};
	await fixture.beads.comments.add(
		fixture.scope,
		target.source,
		`${WORK_REVIEW_RECEIPT} ${JSON.stringify(receiptData)}`,
	);

	const input = {
		branch: decision.branch,
		token: decision.token,
		taskId: candidate.taskId,
		fingerprint: candidate.fingerprint,
		requestId: target.requestId,
		toolingOnly: true as const,
		continuation,
		evidence: decision.evidence,
	};
	return { ...fixture, target, input, additional };
}

// eslint-disable-next-line max-statements -- Seed native authority evidence without executing recovery.
async function cancellationEvidence(
	fixture: Awaited<ReturnType<typeof workReviewFixture>>,
	target: Awaited<ReturnType<typeof failedWork>>,
	options: NonNullable<Parameters<typeof prepared>[typeof NONE]>,
): Promise<WorkReviewRecover["continuation"]> {
	if (!options.cancelled || options.continuation === "missing") {
		return;
	}
	const native = await fixture.beads.show(fixture.scope, target.requestId);
	const authority = await fixture.beads.comments.add(
		fixture.scope,
		target.source,
		"ct explicitly requested stalled development resume. " +
			`Tooling pause cleared for ${target.requestId}, same run ${target.anchor}.`,
	);
	let continuation: NonNullable<WorkReviewRecover["continuation"]> = {
		requestId: target.requestId,
		sourceId: target.source,
		runId: target.anchor,
		closedAt: native.closed_at!,
		toolingPause: true,
		continue: true,
		authority: {
			requestedBy: "ct",
			taskId: target.source,
			commentId: authority.id,
			author: authority.author,
			quote: "ct explicitly requested stalled development resume.",
		},
	};
	if (options.continuation === "stale") {
		continuation = { ...continuation, closedAt: "previous-closure" };
	} else if (options.continuation === "unrelated") {
		continuation = { ...continuation, runId: "another-run" };
	} else if (options.continuation === "unlinked") {
		continuation.authority.quote = "Unrelated assertion";
	} else if (options.continuation === "forged-author") {
		continuation.authority.author = "ct";
	}
	if (options.continuation === "assertion") {
		await fixture.beads.comments.add(
			{ ...fixture.scope, actor: "arbitrary-agent" },
			target.requestId,
			'Colony work-review continuation: {"toolingPause":true,"continue":true}',
		);
		return;
	}
	return continuation;
}

const blocked = await prepared({ status: "blocked" });

const cancelled = await prepared({ openAnchor: true, cancelled: true });

const stopped = await prepared();
stopped.effects.stopped = false;

const partial = await prepared({ openAnchor: true });
const originalRetry = partial.runtime.workReview.retry;
partial.runtime.workReview.retry = async (input) => {
	await originalRetry(input);
	throw new Error("Replacement label publication interrupted");
};

const reserved = await prepared();
const ancestor = await createTask(reserved, { assignee: "another-agent" });
await reserved.beads.dep.add(reserved.scope, reserved.target.source, ancestor, "parent-child");

const disabled = await prepared();
disabled.runtime.config.auto_work_reviews = null;

const assignedSource = await prepared({ openAnchor: true, assignedSource: true });

const raced = await prepared();
let changed = false;
raced.runtime.beads = beforeTrackerWrite(raced.beads, async (_scope, ids) => {
	if (ids.includes(raced.parent) && !changed) {
		changed = true;
		await raced.beads.update(raced.scope, [raced.parent], { title: "Concurrent control update" });
	}
});

const consumed = await prepared({ status: "blocked" });
consumed.runtime.workReview.retry = () =>
	Promise.reject(new Error("Retry unavailable after unblock"));

const budget = await prepared({ openAnchor: true });
const { source: budgetSource, anchor: budgetAnchor, requestId: predecessorId } = budget.target;
const replacementId = await createSpawn(budget, budgetAnchor, {
	deps: [
		{ id: budgetAnchor, type: "related" },
		{ id: predecessorId, type: "supersedes" },
	],
});
await budget.beads.close(budget.scope, replacementId, { reason: "exhausted" });
const reservation = {
	token: "earlier-review",
	taskId: budgetSource,
	requestId: predecessorId,
	lineageId: predecessorId,
	phase: "submitted",
	replacementIds: [replacementId],
	reopenedIds: [],
	detail: "Prior automatic recovery",
	recordedAt: budget.time.now,
	evidence: ["Earlier cleared tooling interruption"],
};
await budget.beads.comments.add(
	budget.scope,
	predecessorId,
	`${WORK_REVIEW_RECOVERY} ${JSON.stringify(reservation)}`,
);
const budgetRecords = await budget.beads.showMany(budget.scope, [
	budgetSource,
	budgetAnchor,
	predecessorId,
	replacementId,
]);
const nextCandidate = {
	taskId: budgetSource,
	requestId: replacementId,
	fingerprint: workReviewFingerprint(budgetRecords),
};
const nextPublication = await seedWorkReview(budget, {
	branch: "in_progress",
	token: "next-review",
	controlParent: budget.parent,
	candidates: [nextCandidate],
});
const nextInput = {
	...budget.input,
	...nextCandidate,
	requestId: replacementId,
	token: "next-review",
};
const nextFinding = {
	branch: nextInput.branch,
	token: nextInput.token,
	taskId: nextInput.taskId,
	fingerprint: nextInput.fingerprint,
	classification: "tooling",
	evidence: [replacementId],
	diagnosis: "Replacement failed",
	nextAction: "Caller follow-up",
	reviewRunId: nextPublication.runId,
	reviewRequestId: nextPublication.requestId,
	recordedAt: budget.time.now,
};
await budget.beads.comments.add(
	budget.scope,
	budgetSource,
	`${WORK_REVIEW_RECEIPT} ${JSON.stringify(nextFinding)}`,
);

const completedDependency = await prepared({ openAnchor: true, closedPrerequisite: true });

function observeRecoveryWrites(fixture: Awaited<ReturnType<typeof prepared>>) {
	const effects = { writes: NONE };
	fixture.runtime.beads = {
		...fixture.beads,
		update: (...args) => {
			effects.writes += ONE;
			return fixture.beads.update(...args);
		},
		comments: {
			...fixture.beads.comments,
			add: (...args) => {
				effects.writes += ONE;
				return fixture.beads.comments.add(...args);
			},
		},
	};
	return effects;
}

const refusedContinuations = [
	"missing",
	"assertion",
	"stale",
	"unrelated",
	"unlinked",
	"forged-author",
] as const;
const cancelledRefusals = new Map(
	await Promise.all(
		refusedContinuations.map(async (continuation) => {
			const fixture = await prepared({ openAnchor: true, cancelled: true, continuation });
			return [continuation, { fixture, effects: observeRecoveryWrites(fixture) }] as const;
		}),
	),
);
test.each([...refusedContinuations])(
	"cancelled %s authority is report-only with no recovery effects",
	async (continuation) => {
		const { fixture, effects } = cancelledRefusals.get(continuation)!;
		await expect(recoverWorkReview(fixture.runtime, fixture.input)).rejects.toBeInstanceOf(
			WorkReviewError,
		);
		expect(effects.writes).toBe(NONE);
		expect(fixture.effects.retries).toBe(NONE);
	},
);

const unsupportedCases = [
	"missing_checkpoint",
	"incompatible_definition",
	"changed_checkpoint",
	"changed_assignment",
] as const;
const unsupported = new Map(
	await Promise.all(
		unsupportedCases.map(async (reason) => {
			const fixture = await prepared({ status: "blocked" });
			let reads = NONE;
			fixture.runtime.workReview.continuation = () => {
				reads += ONE;
				if (reason === "changed_assignment") {
					return fixture.beads
						.show(fixture.scope, fixture.target.requestId)
						.then(async (request) => {
							const recipe = JSON.parse(request.description);
							recipe.assignment = {
								kind: "stage",
								runId: "other-run",
								stageId: fixture.target.anchor,
							};
							await fixture.beads.update(fixture.scope, [request.id], {
								description: JSON.stringify(recipe),
							});
							return { checkpoint: "checkpoint", savedAt: "saved", currentHash: "definition" };
						});
				}
				if (reason !== "changed_checkpoint") {
					throw new WorkReviewError("unsupported_continuation", reason);
				}
				return Promise.resolve({
					checkpoint: "checkpoint",
					savedAt: String(reads),
					currentHash: "definition",
				});
			};
			return [reason, { fixture, effects: observeRecoveryWrites(fixture) }] as const;
		}),
	),
);

const stage = await prepared({ stage: true, openAnchor: true });
const stageInspections: object[] = [];
stage.runtime.workReview.continuation = (input) => {
	stageInspections.push(input.request.assignment);
	return Promise.resolve({ checkpoint: "checkpoint", savedAt: "saved", currentHash: "definition" });
};
test("supported stage recovery preserves the original run and stage through publication", async () => {
	const result = await recoverWorkReview(stage.runtime, stage.input);
	const replacement = await stage.beads.show(stage.scope, result.replacementIds[NONE]!);
	const assignment = { kind: "stage", runId: stage.target.source, stageId: stage.target.anchor };
	expect(result.state).toBe("submitted");
	expect(JSON.parse(replacement.description).assignment).toEqual(assignment);
	expect(stageInspections.length).toBeGreaterThan(NONE);
	expect(
		stageInspections.every((inspected) => JSON.stringify(inspected) === JSON.stringify(assignment)),
	).toBe(true);
});
test.each([...unsupportedCases])(
	"%s refuses before allowance, reopening or retry",
	async (reason) => {
		const { fixture, effects } = unsupported.get(reason)!;
		await expect(recoverWorkReview(fixture.runtime, fixture.input)).rejects.toBeInstanceOf(
			WorkReviewError,
		);
		expect(effects.writes).toBe(NONE);
		expect(fixture.effects.retries).toBe(NONE);
	},
);

test("disabling policy rejects recovery from an already-running review", async () => {
	await expect(recoverWorkReview(disabled.runtime, disabled.input)).rejects.toBeInstanceOf(
		WorkReviewError,
	);
	expect(disabled.effects.retries).toBe(NONE);
});

test("a changed source claim invalidates the recommendation before retry", async () => {
	await expect(recoverWorkReview(reserved.runtime, reserved.input)).rejects.toBeInstanceOf(
		WorkReviewError,
	);
	expect(reserved.effects.retries).toBe(NONE);
});

test("a stranded agent-assigned source stays diagnosable but its existing claim prevents retry", async () => {
	await expect(
		recoverWorkReview(assignedSource.runtime, assignedSource.input),
	).rejects.toBeInstanceOf(WorkReviewError);
	const source = await assignedSource.beads.show(
		assignedSource.scope,
		assignedSource.target.source,
	);
	expect(source.assignee).toBe("previous-worker");
	expect(assignedSource.effects.retries).toBe(NONE);
});

test("missing current stopped-process proof consumes no automatic allowance", async () => {
	await expect(recoverWorkReview(stopped.runtime, stopped.input)).rejects.toBeInstanceOf(
		WorkReviewError,
	);
	const { control } = await stopped.control();
	expect(control.recoveries).toEqual([]);
	expect(stopped.effects.retries).toBe(NONE);
});

test("a competing native reservation prevents any retry effect", async () => {
	await expect(recoverWorkReview(raced.runtime, raced.input)).rejects.toBeInstanceOf(Error);
	expect(raced.effects.retries).toBe(NONE);
});

test("tooling recovery conditionally reopens its anchor and retains the same saved assignment", async () => {
	const result = await recoverWorkReview(blocked.runtime, blocked.input);
	expect(result.state).toBe("submitted");
	expect(result.reopenedIds).toEqual([blocked.target.anchor]);
	expect(result.replacementIds).toHaveLength(ONE);
	expect(blocked.effects.retries).toBe(ONE);
});

test("cancelled open run reaches retry while its source remains in progress", async () => {
	const result = await recoverWorkReview(cancelled.runtime, cancelled.input);
	expect(result.state).toBe("submitted");
	expect(result.reopenedIds).toEqual([]);
	const source = await cancelled.beads.show(cancelled.scope, cancelled.target.source);
	expect(source.status).toBe("in_progress");
	expect(cancelled.effects.retries).toBe(ONE);
});

test("partial retry publication retains its replacement without duplication", async () => {
	const result = await recoverWorkReview(partial.runtime, partial.input);
	expect(result.state).toBe("attention");
	expect(result.replacementIds).toHaveLength(ONE);
	const { control } = await partial.control();
	expect(control.recoveries[NONE]).toMatchObject({
		phase: "attention",
		replacementIds: result.replacementIds,
		reopenedIds: [],
	});
	expect(partial.effects.retries).toBe(ONE);
});

test("an interrupted unblock remains visible after restart with a concrete caller continuation", async () => {
	await recoverWorkReview(consumed.runtime, consumed.input);
	consumed.time.now += HOUR;
	const { control } = await consumed.control();
	expect(control.recoveries[NONE]).toMatchObject({
		phase: "attention",
		reopenedIds: [consumed.target.anchor],
	});
	expect(control.recoveries[NONE]!.detail).toContain("Retry unavailable");
	expect(consumed.effects.retries).toBe(NONE);
});

test("a failed successor cannot replenish its native lineage allowance", async () => {
	const result = await recoverWorkReview(budget.runtime, nextInput);
	expect(result.state).toBe("already_attempted");
	expect(budget.effects.retries).toBe(NONE);
});

test("a completed prerequisite's retired assignee does not reserve current continuation", async () => {
	const result = await recoverWorkReview(completedDependency.runtime, completedDependency.input);
	expect(result.state).toBe("submitted");
	const prerequisite = await completedDependency.beads.show(
		completedDependency.scope,
		completedDependency.additional[NONE]!,
	);
	expect(prerequisite.assignee).toBe("retired-worker");
});

const healthCases = [
	{
		name: "alert before unblock",
		stopAt: BEFORE_UNBLOCK,
		phase: "reserved",
		status: "blocked",
		reopened: false,
	},
	{
		name: "unreadable health before retry",
		stopAt: BEFORE_RETRY,
		phase: "unblocked",
		status: "open",
		reopened: true,
	},
];
const healthFixtures = new Map(
	await Promise.all(
		healthCases.map(async ({ name, stopAt }) => {
			const fixture = await prepared({ status: "blocked" });
			const counters = {
				checks: NONE,
				failed: false,
				readsAfterFailure: NONE,
				writesAfterFailure: NONE,
			};
			const native = fixture.beads;
			fixture.runtime.workReview.assertTracker = () => {
				counters.checks += ONE;
				if (counters.checks === stopAt) {
					counters.failed = true;
					if (stopAt === BEFORE_UNBLOCK) {
						throw new WorkReviewError("tracker_alert", "Selected tracker alert active");
					}
					throw new SyntaxError("Alert status could not be decoded");
				}
				return Promise.resolve();
			};
			fixture.runtime.beads = {
				...native,
				show: (scope, id) => {
					if (counters.failed) {
						counters.readsAfterFailure += ONE;
					}
					return native.show(scope, id);
				},
				update: (scope, ids, input) => {
					if (counters.failed) {
						counters.writesAfterFailure += ONE;
					}
					return native.update(scope, ids, input);
				},
				comments: {
					...native.comments,
					add: (scope, id, text) => {
						if (counters.failed) {
							counters.writesAfterFailure += ONE;
						}
						return native.comments.add(scope, id, text);
					},
				},
			};
			return [name, { fixture, counters }] as const;
		}),
	),
);
test.each(healthCases)(
	"$name stops all native effects and retains confirmed partial IDs",
	// eslint-disable-next-line max-statements -- Verify one paused operation and all absence-of-effect evidence together.
	async ({ name, phase, status, reopened }) => {
		const { fixture, counters } = healthFixtures.get(name)!;
		const failure = await recoverWorkReview(fixture.runtime, fixture.input).catch(
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(WorkReviewHealthError);
		const paused = failure as WorkReviewHealthError;
		expect(paused.phase).toBe(phase);
		expect(paused.replacementIds).toEqual([]);
		let reopenedIds: string[] = [];
		if (reopened) {
			reopenedIds = [fixture.target.anchor];
		}
		expect(paused.reopenedIds).toEqual(reopenedIds);
		expect(counters.readsAfterFailure).toBe(NONE);
		expect(counters.writesAfterFailure).toBe(NONE);
		expect(fixture.effects.retries).toBe(NONE);
		const target = await fixture.beads.show(fixture.scope, fixture.target.source);
		expect(target.status).toBe(status);
		const parent = await fixture.beads.show(fixture.scope, fixture.parent);
		expect(JSON.parse(parent.notes).recoveries[NONE].phase).toBe(phase);
	},
);
