import { z } from "zod";

const NONEMPTY = 1;
const MAX_TEXT = 4096;
const MAX_EVIDENCE = 20;
const text = z.string().trim().min(NONEMPTY);
const continuationAuthoritySchema = z.strictObject({
	requestedBy: text,
	taskId: text,
	commentId: z.number().int(),
	author: text,
	quote: text,
});
export const workReviewContinuationSchema = z.strictObject({
	requestId: text,
	sourceId: text,
	runId: text,
	closedAt: text,
	toolingPause: z.literal(true),
	continue: z.literal(true),
	authority: continuationAuthoritySchema,
});
export const WORK_REVIEW_BATCH_SIZE = 20;
export const workReviewBranchSchema = z.enum(["blocked", "in_progress"]);
export const workReviewCandidateSchema = z.strictObject({
	taskId: text,
	fingerprint: text,
	requestId: text.nullable(),
});
export const workReviewInputSchema = z.strictObject({
	branch: workReviewBranchSchema,
	token: text,
	controlParent: text,
	candidates: z.array(workReviewCandidateSchema).min(NONEMPTY).max(WORK_REVIEW_BATCH_SIZE),
});
const decisionFields = {
	branch: workReviewBranchSchema,
	token: text,
	taskId: text,
	fingerprint: text,
	evidence: z.array(text).min(NONEMPTY).max(MAX_EVIDENCE),
};
export const workReviewRecordSchema = z.strictObject({
	...decisionFields,
	classification: z.enum(["stable", "tooling", "unknown"]),
	diagnosis: text.max(MAX_TEXT),
	nextAction: text.max(MAX_TEXT),
});
export const workReviewRecoverSchema = z.strictObject({
	...decisionFields,
	requestId: text,
	toolingOnly: z.literal(true),
	/** Human direction assessed by the driver, retaining its recorder; absent means report-only cancellation. */
	continuation: workReviewContinuationSchema.optional(),
});
export const workReviewPreflightSchema = z.strictObject({
	kind: z.literal("work_review_preflight"),
	branch: workReviewBranchSchema,
	candidates: z.array(workReviewCandidateSchema).max(WORK_REVIEW_BATCH_SIZE),
	omitted: z.number().int().nonnegative(),
	excluded: z.number().int().nonnegative(),
	nextCursor: text.nullable(),
});
export const workReviewRecordedSchema = z.strictObject({
	kind: z.literal("work_review_recorded"),
	taskId: text,
	classification: workReviewRecordSchema.shape.classification,
	changed: z.boolean(),
	receiptId: z.number().int(),
});
export const workReviewRecoveredSchema = z.strictObject({
	kind: z.literal("work_review_recovery"),
	taskId: text,
	state: z.enum(["submitted", "attention", "already_attempted"]),
	replacementIds: z.array(text),
	reopenedIds: z.array(text),
	detail: z.string(),
});
export type WorkReviewBranch = z.infer<typeof workReviewBranchSchema>;
export type WorkReviewInput = z.infer<typeof workReviewInputSchema>;
export type WorkReviewCandidate = z.infer<typeof workReviewCandidateSchema>;
export type WorkReviewRecord = z.infer<typeof workReviewRecordSchema>;
export type WorkReviewRecover = z.infer<typeof workReviewRecoverSchema>;
