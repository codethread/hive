/* eslint-disable unicorn/no-null -- Native control fixture fields explicitly represent absent work. */
import { expect, test } from "bun:test";
import { failedWork, seedWorkReview, workReviewFixture } from "./work-review.test-support.ts";
import {
	preflightWorkReview,
	selectWorkReviewCandidates,
	workReviewFingerprint,
} from "./work-review.ts";
import { WORK_REVIEW_BATCH_SIZE } from "@hive/shared";
import { createTask } from "./tracker.test-support.ts";
import { reconcileWorkReviews } from "./work-review-runtime.ts";

const NONE = 0;
const ONE = 1;
const ID_WIDTH = 3;
const HOUR = 3_600_000;

const empty = await workReviewFixture();
const emptyClock = { nextDue: NONE };
test(
	"empty hourly preflight launches no drone and subsequent serial passes perform no " +
		"native scan #test-394",
	async () => {
		await reconcileWorkReviews(empty.runtime, emptyClock);
		const { scans } = empty.effects;
		empty.time.now += ONE;
		await reconcileWorkReviews(empty.runtime, emptyClock);
		expect(empty.effects.scans).toBe(scans);
		expect(empty.submissions).toEqual([]);
	},
);

const branches = await workReviewFixture();
await createTask(branches, { status: "blocked" });
await failedWork(branches, { openAnchor: true });
test("both branches have independent ordinary submissions and next-hour native deadlines #test-362", async () => {
	await reconcileWorkReviews(branches.runtime, { nextDue: NONE });
	const { control } = await branches.control();
	expect(branches.submissions.map(({ input }) => input.branch)).toEqual(["blocked", "in_progress"]);
	expect(control.branches.blocked.nextDue).toBe(branches.time.now + HOUR);
	expect(control.branches.in_progress.nextDue).toBe(branches.time.now + HOUR);
});

const partial = await workReviewFixture();
const partialTask = await createTask(partial, { status: "blocked" });
const partialRecords = await partial.beads.showMany(partial.scope, [partialTask]);
const partialInput = {
	branch: "blocked" as const,
	token: "interrupted-review",
	controlParent: partial.parent,
	candidates: [
		{ taskId: partialTask, requestId: null, fingerprint: workReviewFingerprint(partialRecords) },
	],
};
const confirmed = await seedWorkReview(partial, partialInput);
const partialControl = await partial.control();
partialControl.control.branches.blocked.active!.phase = "attention";
partialControl.control.branches.blocked.active!.detail =
	"Submission interrupted after native creation";
await partial.beads.update(partial.scope, [partial.parent], {
	notes: JSON.stringify(partialControl.control),
});
partial.runtime.workReview.start = () => {
	throw new Error("Interrupted publication must not spawn again");
};
partial.time.now += HOUR;

test("interrupted submission inspects its confirmed request without creating a duplicate workflow", async () => {
	await reconcileWorkReviews(partial.runtime, { nextDue: NONE });
	const { control } = await partial.control();
	expect(control.branches.blocked.active).toMatchObject({ phase: "submitted", ...confirmed });
	expect(partial.submissions).toEqual([]);
});

const archived = await workReviewFixture();
const HISTORY_SIZE = 50;
await Promise.all(
	Array.from({ length: HISTORY_SIZE }, async () => {
		const previous = await failedWork(archived);
		await archived.beads.close(archived.scope, previous.source, { reason: "Historical work" });
	}),
);
let historyRead = false;
const { listProjected } = archived.runtime.beads;
archived.runtime.beads = {
	...archived.beads,
	listProjected: (scope, selection, fields) => {
		if (selection.labels?.includes("system") && selection.ids === undefined) {
			historyRead = true;
		}
		return listProjected(scope, selection, fields);
	},
};
test("in-progress fast path does not query or hydrate the failed-request archive", async () => {
	const result = await preflightWorkReview(archived.runtime, "in_progress");
	expect(result.candidates).toEqual([]);
	expect(historyRead).toBe(false);
});

const overlapping = await workReviewFixture();
const commonSource = await createTask(overlapping, { status: "in_progress" });
const firstSource = await failedWork(overlapping, { openAnchor: true });
const secondSource = await failedWork(overlapping, { openAnchor: true });
await overlapping.beads.dep.add(
	overlapping.scope,
	firstSource.source,
	commonSource,
	"parent-child",
);
await overlapping.beads.dep.add(
	overlapping.scope,
	secondSource.source,
	commonSource,
	"parent-child",
);
const nativeReads = new Map<string, number>();
const originalShow = overlapping.beads.show;
overlapping.runtime.beads = {
	...overlapping.beads,
	show: (scope, id) => {
		nativeReads.set(id, (nativeReads.get(id) ?? NONE) + ONE);
		return originalShow(scope, id);
	},
};
test("overlapping scopes preserve the closest source and reuse discovery reads #test-534", async () => {
	const result = await preflightWorkReview(overlapping.runtime, "in_progress");
	expect(result.candidates.map(({ taskId }) => taskId).toSorted()).toEqual(
		[firstSource.source, secondSource.source].toSorted(),
	);
	expect(new Set(result.candidates.map(({ taskId }) => taskId)).size).toBe(
		result.candidates.length,
	);
	expect(nativeReads.get(firstSource.source)).toBe(ONE);
	expect(nativeReads.get(secondSource.source)).toBe(ONE);
});

const dueCandidates = Array.from({ length: WORK_REVIEW_BATCH_SIZE + ONE }, (_value, index) => ({
	taskId: `task-${String(index).padStart(ID_WIDTH, "0")}`,
	fingerprint: "semantic",
	requestId: null,
}));
test("bounded manifests rotate the omitted candidate into the next batch", () => {
	const first = selectWorkReviewCandidates(dueCandidates, null);
	const second = selectWorkReviewCandidates(dueCandidates, first.at(-ONE)!.taskId);
	expect(first).toHaveLength(WORK_REVIEW_BATCH_SIZE);
	expect(
		second.some((candidate) => !first.some((previous) => previous.taskId === candidate.taskId)),
	).toBe(true);
});

const halted = await workReviewFixture();
halted.runtime.workReview.assertTracker = () => Promise.reject(new Error("Tracker alert active"));
test("tracker alert failure stops the check before inventory or submission", async () => {
	await expect(reconcileWorkReviews(halted.runtime, { nextDue: NONE })).rejects.toBeInstanceOf(
		Error,
	);
	expect(halted.submissions).toEqual([]);
});
