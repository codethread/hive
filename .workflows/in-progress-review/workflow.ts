import type { ReviewContext, ReviewEvent } from "../work-review.ts";
import { assign, setup } from "xstate";
import { recoverySchema, reviewContextSchema } from "../work-review.ts";
import { workReviewInputSchema } from "@hive/shared";
import { z } from "zod";

export { commandSchemas, validateCommand } from "../work-review.ts";
export const inputSchema = workReviewInputSchema.extend({ branch: z.literal("in_progress") });
export const resumeSchema = reviewContextSchema.extend({ branch: z.literal("in_progress") });

export function runBrief(input: z.infer<typeof inputSchema>) {
	return {
		title: "Review stranded in-progress work",
		description: `Inspect ${input.candidates.length} managed in-progress tasks with unsuccessful requests and
recover only authorized tooling interruptions.
Review token: ${input.token}. Control parent: ${input.controlParent}.`,
	};
}

export const machine = setup({
	types: {
		context: {} as ReviewContext,
		input: {} as z.infer<typeof inputSchema>,
		events: {} as ReviewEvent,
	},
	actions: {
		rememberRecovery: assign(({ event }) => ({
			targets: recoverySchema.parse(event.data).targets,
		})),
	},
}).createMachine({
	id: "in-progress-review",
	context: ({ input }) => ({ ...input, targets: [] }),
	initial: "inspect",
	states: {
		inspect: {
			meta: {
				title: "Inspect stranded in-progress work",
				commands: { reviewed: "REVIEWED", recover: "RECOVER" },
				task: ({ context }: { context: ReviewContext }) => ({
					instructions: `Inspect only the supplied managed in-progress candidates. Read each task's settled intent,
source/ancestor reservations, prerequisites and exact failed or cancelled request assignment
and supersession history. Distinguish stranded execution from legitimate dependency waiting or
a live replacement. An old agent assignment alone does not prove live execution. Preserve
human/HITL/manual reservations and existing claims; an unassigned run does not erase a source claim.

Classify tooling only when concrete evidence identifies a tooling interruption. Use unknown
for an unresolved product decision, ordinary waiting or missing/conflicting evidence; stable
is reserved for native blocked work. State the diagnosis, next action and exact evidence
references. Cancellation without continuation authority remains diagnosable.

Read colony work-review record --help and colony work-review --schema. Record current
diagnoses through that command with the supplied branch, token, task ID and fingerprint. Keep
its receiptId with the original record input in the outcome. If evidence changed or a
candidate is no longer eligible, report stale with its frozen fingerprint and current
evidence. This stage authorizes diagnosis records only, not retries or implementation of
examined work.

Choose reviewed when no candidate has a supported recovery.
Choose recover only for recorded tooling cases with a cleared impediment, settled continuation
intent and the exact unsuccessful request. For cancelled requests, read colony work-review
recover --help before supplying continuation in a target. Account for every frozen candidate
exactly once; give unsupported cases a concrete next action.

Frozen batch: ${JSON.stringify(context)}`,
				}),
			},
			on: { REVIEWED: "done", RECOVER: { actions: "rememberRecovery", target: "recover" } },
		},
		recover: {
			meta: {
				title: "Resume authorized stranded work",
				commands: { recovered: "RECOVERED" },
				task: ({ context }: { context: ReviewContext }) => ({
					instructions: `Resume only the supplied stranded requests within their settled work intent. Read colony
work-review recover --help for source reservations, stopped-execution proof, cancellation
continuation and partial effects, and colony work-review --schema for payloads.

For a cancelled predecessor, verify that the cited native evidence records explicit existing
human direction to continue this tooling interruption. Preserve the actual recorder's identity.
Missing, stale, unrelated or ambiguous authority remains deferred; a diagnosis grants no permission.

Invoke that command once per target. It may requeue the unassigned request anchor while
preserving a distinct in-progress source and the same saved run/stage. This stage authorizes
only that bounded continuation; unsupported repairs need a next action for the caller.

Tracker alerts or health-read failures suspend this stage and its native delivery writes;
follow the recovery help's tracker-alert instructions before continuing.

With tracker health established, choose recovered after every target has a result: command
state submitted maps to result kind submitted; attention, already_attempted or other refusal
maps to deferred. Retain replacementIds and reopenedIds, including partial effects, with
evidence and next actions. Submitted means a replacement was requested; examined work remains
unfinished.

Recovery batch: ${JSON.stringify(context)}`,
				}),
			},
			on: { RECOVERED: "done" },
		},
		done: { type: "final" },
	},
});
