import {
	WORK_REVIEW_BATCH_SIZE,
	workReviewInputSchema,
	workReviewRecordSchema,
	workReviewRecoverSchema,
} from "@hive/shared";
import { z } from "zod";

const NONEMPTY = 1;
const text = z.string().trim().min(NONEMPTY);
const staleSchema = z.strictObject({
	kind: z.literal("stale"),
	taskId: text,
	fingerprint: text,
	evidence: z.array(text).min(NONEMPTY),
});
const decisionSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("recorded"),
		record: workReviewRecordSchema,
		receiptId: z.number().int(),
	}),
	staleSchema,
]);
const reviewedSchema = z.strictObject({
	evidence: text,
	decisions: z.array(decisionSchema).min(NONEMPTY).max(WORK_REVIEW_BATCH_SIZE),
});
export const recoverySchema = reviewedSchema.extend({
	targets: z.array(workReviewRecoverSchema).min(NONEMPTY).max(WORK_REVIEW_BATCH_SIZE),
});
const recoveryResultSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("submitted"),
		taskId: text,
		requestId: text,
		replacementIds: z.array(text).min(NONEMPTY),
		reopenedIds: z.array(text),
		evidence: z.array(text).min(NONEMPTY),
	}),
	z.strictObject({
		kind: z.literal("deferred"),
		taskId: text,
		requestId: text,
		replacementIds: z.array(text),
		reopenedIds: z.array(text),
		evidence: z.array(text).min(NONEMPTY),
	}),
]);
const recoveredSchema = z.strictObject({
	evidence: text,
	results: z.array(recoveryResultSchema).min(NONEMPTY).max(WORK_REVIEW_BATCH_SIZE),
});
export const commandSchemas = {
	reviewed: reviewedSchema,
	recover: recoverySchema,
	recovered: recoveredSchema,
};
export const reviewContextSchema = workReviewInputSchema.extend({
	targets: z.array(workReviewRecoverSchema).max(WORK_REVIEW_BATCH_SIZE),
});
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export interface ReviewEvent {
	type: "REVIEWED" | "RECOVER" | "RECOVERED";
	data: unknown;
}

export function validateCommand(
	entry: { context: Record<string, unknown> },
	command: string,
	data: unknown,
): void {
	const context = reviewContextSchema.parse(entry.context);
	if (command === "recovered") {
		validateRecoveryResults(context, recoveredSchema.parse(data));
		return;
	}
	if (command === "recover") {
		const outcome = recoverySchema.parse(data);
		validateDecisions(context, outcome.decisions);
		validateRecoveryTargets(context, outcome);
		return;
	}
	validateDecisions(context, reviewedSchema.parse(data).decisions);
}

function validateDecisions(
	context: ReviewContext,
	decisions: z.infer<typeof decisionSchema>[],
): void {
	const records = decisions.map((decision) => decisionRecord(decision));
	assertExactIds(
		records.map(({ taskId }) => taskId),
		context.candidates.map(({ taskId }) => taskId),
	);
	for (const record of records) {
		const candidate = context.candidates.find(({ taskId }) => taskId === record.taskId)!;
		if (candidate.fingerprint !== record.fingerprint) {
			throw new Error("Decision must retain the frozen candidate fingerprint");
		}
		if ("token" in record && (record.token !== context.token || record.branch !== context.branch)) {
			throw new Error("Decision must retain the review token and branch");
		}
	}
}

function validateRecoveryTargets(
	context: ReviewContext,
	outcome: z.infer<typeof recoverySchema>,
): void {
	const { targets, decisions } = outcome;
	if (new Set(targets.map(({ taskId }) => taskId)).size !== targets.length) {
		throw new Error("Each recovery target must appear once");
	}
	for (const target of targets) {
		const candidate = context.candidates.find(({ taskId }) => taskId === target.taskId);
		const decision = decisions.find(
			(item) => item.kind === "recorded" && item.record.taskId === target.taskId,
		);
		if (
			!candidate ||
			candidate.requestId !== target.requestId ||
			candidate.fingerprint !== target.fingerprint ||
			target.token !== context.token ||
			target.branch !== context.branch ||
			decision?.kind !== "recorded" ||
			decision.record.classification !== "tooling"
		) {
			throw new Error("Recovery requires the frozen candidate and a recorded tooling decision");
		}
	}
}

function validateRecoveryResults(
	context: ReviewContext,
	outcome: z.infer<typeof recoveredSchema>,
): void {
	assertExactIds(
		outcome.results.map(({ taskId }) => taskId),
		context.targets.map(({ taskId }) => taskId),
	);
	for (const result of outcome.results) {
		if (
			!context.targets.some(
				(target) => target.taskId === result.taskId && target.requestId === result.requestId,
			)
		) {
			throw new Error("Recovery result must retain its target task and original request");
		}
	}
}

function decisionRecord(decision: z.infer<typeof decisionSchema>) {
	if (decision.kind === "recorded") {
		return decision.record;
	}
	return decision;
}

function assertExactIds(actual: string[], expected: string[]): void {
	if (
		new Set(actual).size !== actual.length ||
		actual.length !== expected.length ||
		expected.some((id) => !actual.includes(id))
	) {
		throw new Error("Outcome must account for each frozen candidate exactly once");
	}
}
