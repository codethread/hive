/* eslint-disable unicorn/no-null -- Native review fixtures use explicit absent request IDs. */
import {
	WORK_REVIEW_RECEIPT,
	WorkReviewError,
	preflightWorkReview,
	recordWorkReview,
	workReviewFingerprint,
} from "./work-review.ts";
import { createSpawn, createTask } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { failedWork, workReviewFixture } from "./work-review.test-support.ts";

const NONE = 0;
const ONE = 1;
const origin = { requestId: null, reviewRunId: "review-run", reviewRequestId: "review-request" };
const stable = await workReviewFixture();
const prerequisite = await createTask(stable);
const blocked = await createTask(stable, {
	status: "blocked",
	deps: [{ id: prerequisite, type: "blocks" }],
	due: "2099-01-01",
});
const stableRecords = await stable.beads.showMany(stable.scope, [blocked, prerequisite]);
const initial = {
	taskId: blocked,
	fingerprint: workReviewFingerprint(stableRecords),
	requestId: null,
};
const finding = {
	...initial,
	branch: "blocked" as const,
	token: "review",
	classification: "stable" as const,
	diagnosis: "Product prerequisite",
	evidence: [prerequisite],
	nextAction: "Complete prerequisite",
};
const { requestId: _requestId, ...record } = finding;
const stableReceipt = {
	...record,
	reviewRunId: origin.reviewRunId,
	reviewRequestId: origin.reviewRequestId,
	recordedAt: stable.time.now,
};
await stable.beads.comments.add(
	stable.scope,
	blocked,
	`${WORK_REVIEW_RECEIPT} ${JSON.stringify(stableReceipt)}`,
);
await stable.beads.update(stable.scope, [blocked], { addLabels: ["blocker:stable"] });

test("own annotations stay fresh; prerequisite edits make blocked work due", async () => {
	const fresh = await preflightWorkReview(stable.runtime, "blocked");
	expect(fresh.candidates).toEqual([]);
	await stable.beads.update(stable.scope, [prerequisite], { description: "Requirement changed" });
	const changed = await preflightWorkReview(stable.runtime, "blocked");
	expect(changed.candidates.map(({ taskId }) => taskId)).toEqual([blocked]);
});

const dedup = await workReviewFixture();
const tooling = await createTask(dedup, { status: "blocked" });
const toolingRecords = await dedup.beads.showMany(dedup.scope, [tooling]);
const candidate = { taskId: tooling, fingerprint: workReviewFingerprint(toolingRecords) };
const diagnosis = {
	branch: "blocked" as const,
	token: "first",
	taskId: tooling,
	fingerprint: candidate.fingerprint,
	classification: "tooling" as const,
	diagnosis: "Missing executable",
	evidence: ["tool --version"],
	nextAction: "Restore executable",
};
const toolingReceipt = {
	...diagnosis,
	reviewRunId: origin.reviewRunId,
	reviewRequestId: origin.reviewRequestId,
	recordedAt: dedup.time.now,
};
await dedup.beads.comments.add(
	dedup.scope,
	tooling,
	`${WORK_REVIEW_RECEIPT} ${JSON.stringify(toolingReceipt)}`,
);
test("unchanged tooling diagnoses remain due without adding an hourly comment", async () => {
	expect(
		await recordWorkReview(dedup.runtime, { ...diagnosis, token: "next-hour" }, origin),
	).toMatchObject({ changed: false });
	const task = await dedup.beads.show(dedup.scope, tooling);
	expect(task.comments).toHaveLength(ONE);
	const due = await preflightWorkReview(dedup.runtime, "blocked");
	expect(due.candidates).toHaveLength(ONE);
});

const reservationCases = [
	{ name: "HITL", input: { labels: ["hitl"] } },
	{ name: "human", input: { assignee: "ct" } },
	{ name: "manual hold", input: { labels: ["manual"] } },
	{ name: "deferred", input: { defer: "2099-01-01" } },
];
const reservedFixtures = new Map(
	await Promise.all(
		reservationCases.map(async ({ name, input }) => {
			const fixture = await workReviewFixture();
			await createTask(fixture, { status: "blocked", ...input });
			return [name, fixture] as const;
		}),
	),
);
test.each(reservationCases)(
	"$name work is excluded without a classification mutation",
	async ({ name }) => {
		const fixture = reservedFixtures.get(name)!;
		const result = await preflightWorkReview(fixture.runtime, "blocked");
		expect(result.candidates).toEqual([]);
	},
);
const excluded = await workReviewFixture();
await createTask(excluded, { status: "blocked", parent: excluded.parent });
const live = await createTask(excluded, { status: "blocked" });
await createSpawn(excluded, live);
test("blocked work with a pending request stays diagnosable while the control subtree is excluded", async () => {
	const result = await preflightWorkReview(excluded.runtime, "blocked");
	expect(result.candidates).toMatchObject([{ taskId: live, requestId: null }]);
	expect(result.excluded).toBeGreaterThan(NONE);
});

const assigned = await workReviewFixture();
const assignedParent = await createTask(assigned, { assignee: "source-agent" });
const assignedTask = await createTask(assigned, {
	status: "blocked",
	assignee: "task-agent",
	parent: assignedParent,
});
const assignedRecords = await assigned.beads.showMany(assigned.scope, [
	assignedTask,
	assignedParent,
]);
const assignedFinding = {
	...record,
	taskId: assignedTask,
	fingerprint: workReviewFingerprint(assignedRecords),
};
test("blocked diagnosis annotates agent-assigned work without changing source claims or retrying", async () => {
	await recordWorkReview(assigned.runtime, assignedFinding, origin);
	const source = await assigned.beads.show(assigned.scope, assignedParent);
	const task = await assigned.beads.show(assigned.scope, assignedTask);
	expect(source.assignee).toBe("source-agent");
	expect(task.assignee).toBe("task-agent");
	expect(task.labels).toContain("blocker:stable");
	expect(assigned.effects.retries).toBe(NONE);
});

const cancelled = await workReviewFixture();
const paused = await failedWork(cancelled, { openAnchor: true, cancelled: true });
test("cancelled driver remains diagnosable without granting recovery permission", async () => {
	const held = await preflightWorkReview(cancelled.runtime, "in_progress");
	expect(held.candidates).toMatchObject([{ taskId: paused.source, requestId: paused.requestId }]);
	expect(cancelled.effects.retries).toBe(NONE);
});

const strandedAssigned = await workReviewFixture();
const stranded = await failedWork(strandedAssigned, { openAnchor: true });
await strandedAssigned.beads.update(strandedAssigned.scope, [stranded.source], {
	assignee: "previous-worker",
});
test("a failed driver beneath an old agent-assigned in-progress source remains reviewable", async () => {
	const result = await preflightWorkReview(strandedAssigned.runtime, "in_progress");
	expect(result.candidates).toMatchObject([
		{ taskId: stranded.source, requestId: stranded.requestId },
	]);
	expect(strandedAssigned.effects.retries).toBe(NONE);
});

const stale = await workReviewFixture();
const staleTask = await createTask(stale, { status: "blocked" });
const staleRecords = await stale.beads.showMany(stale.scope, [staleTask]);
const staleCandidate = { fingerprint: workReviewFingerprint(staleRecords) };
await stale.beads.update(stale.scope, [staleTask], { acceptanceCriteria: "New acceptance" });
test("record refuses a semantic change instead of applying the stable marker", async () => {
	await expect(
		recordWorkReview(
			stale.runtime,
			{ ...record, taskId: staleTask, fingerprint: staleCandidate.fingerprint },
			origin,
		),
	).rejects.toBeInstanceOf(WorkReviewError);
	const current = await stale.beads.show(stale.scope, staleTask);
	expect(current.labels).toEqual([]);
});
