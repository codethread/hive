import type { ReviewContext, ReviewEvent } from "../work-review.ts";
import { assign, setup } from "xstate";
import { recoverySchema, reviewContextSchema } from "../work-review.ts";
import { workReviewInputSchema } from "@hive/shared";
import { z } from "zod";

export { commandSchemas, validateCommand } from "../work-review.ts";
export const inputSchema = workReviewInputSchema.extend({ branch: z.literal("blocked") });
export const resumeSchema = reviewContextSchema.extend({ branch: z.literal("blocked") });

export function runBrief(input: z.infer<typeof inputSchema>) {
	return {
		title: "Review blocked work",
		description: `Classify ${input.candidates.length} native blocked tasks and recover only proven tooling
failures within their existing work intent.
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
	id: "blocked-review",
	context: ({ input }) => ({ ...input, targets: [] }),
	initial: "classify",
	states: {
		classify: {
			meta: {
				title: "Classify blocked work",
				commands: { reviewed: "REVIEWED", recover: "RECOVER" },
				task: ({ context }: { context: ReviewContext }) => ({
					instructions: `Review this frozen batch of native blocked work. Read each task's brief, blocker evidence,
prerequisites, source/ancestor reservations and exact request history. Dependency waiting
alone is not native blocked status.

Classify stable only for an evidenced product or human requirement whose clearing condition
will be visible in native records. An external condition without a watchable native change
remains unknown. Classify tooling for an evidenced tooling failure; use unknown when evidence
is missing or conflicting. State the diagnosis, what clears it and exact evidence references.
Preserve human/HITL/manual reservations. Agent assignment permits diagnosis only; preserve it.

Read colony work-review record --help and colony work-review --schema. Record each current
diagnosis through that command using the supplied branch, token, task ID and fingerprint; it
owns receipt and label publication. Keep its receiptId with the original record input in the
outcome. If evidence changed or the candidate is no longer eligible, report a stale decision
with the frozen fingerprint and current evidence instead. This stage authorizes diagnosis
records only, not recovery or implementation of examined work.

Choose reviewed when no candidate has a supported recovery.
Choose recover only for the subset recorded as tooling with a cleared impediment, settled
continuation intent and an exact unsuccessful request. Unsupported recovery needs a concrete
next action, not a new repair scope. For cancelled requests, read colony work-review recover
--help before supplying continuation in a target. Both outcomes must account for every frozen
candidate exactly once.

Frozen batch: ${JSON.stringify(context)}`,
				}),
			},
			on: { REVIEWED: "done", RECOVER: { actions: "rememberRecovery", target: "recover" } },
		},
		recover: {
			meta: {
				title: "Recover tooling-blocked work",
				commands: { recovered: "RECOVERED" },
				task: ({ context }: { context: ReviewContext }) => ({
					instructions: `Recover only the supplied candidates whose tooling impediment cleared within existing work
intent. Read colony work-review recover --help for admission, cancellation continuation and
partial-effect handling, and colony work-review --schema for payloads.

For a cancelled predecessor, verify that the cited native evidence records explicit existing
human direction to continue this tooling interruption. Preserve the actual recorder's identity.
Missing, stale, unrelated or ambiguous authority remains deferred; a diagnosis grants no permission.

Invoke the recovery command once per target using the frozen evidence. This stage authorizes
only that bounded action. Unsupported repairs need a next action for the caller; they do not
expand the review's scope.

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
