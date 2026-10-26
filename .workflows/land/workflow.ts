import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const evidenceSchema = z.object({ evidence: text });
const integratedSchema = evidenceSchema.extend({ revision: z.string().regex(/^[a-f\d]{40}$/u) });
const publicationSchema = evidenceSchema.extend({ pr: z.url() });
const targetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("worktree"), branch: text }),
	z.object({ kind: z.literal("pr"), url: z.url() }),
]);

export const inputSchema = z.object({
	beadsDb: text,
	canonicalRoot: text,
	completedTasks: z.array(text),
	request: text,
	target: targetSchema,
});
export const commandSchemas = {
	passed: evidenceSchema,
	integrated: integratedSchema,
	timing: evidenceSchema,
	blocked: evidenceSchema,
	published: publicationSchema,
	deferred: integratedSchema,
	approved: evidenceSchema,
	changes: evidenceSchema,
	next: evidenceSchema,
};

type Input = z.infer<typeof inputSchema>;
interface Context extends Input {
	/** Latest visit evidence; earlier checks and reviews remain on their native beads. */
	evidence: string;
	/** Confirmed integration selects verification after both final reviews. */
	alreadyIntegrated: boolean;
	/** Timing exceptions end in a decision draft after both reviews. */
	timingException: boolean;
}
interface Event {
	/** Outcome mapped by the active task. */
	type:
		| "PASSED"
		| "INTEGRATED"
		| "APPROVED"
		| "CHANGES"
		| "NEXT"
		| "TIMING"
		| "BLOCKED"
		| "PUBLISHED"
		| "DEFERRED";
	/** Original outcome parsed by Busy Bee at submission. */
	data: z.infer<typeof evidenceSchema>;
}

export const resumeSchema = inputSchema.extend({
	evidence: z.string(),
	alreadyIntegrated: z.boolean(),
	timingException: z.boolean(),
});

export function runBrief(input: Input): { title: string; description: string } {
	return {
		title: `Land ${targetTitle(input)}`,
		description:
			`User authorization: ${input.request}\nRetain ${input.canonicalRoot} and BEADS_DB ` +
			`${input.beadsDb}. ` +
			"done proves verified integration and adoption; draft-delivered and merged-blocked " +
			"record incomplete delivery. " +
			`Close completedTasks (${input.completedTasks.join(", ") || "none"}) only against ` +
			`proven source acceptance; ` +
			"keep unmet criteria open with the next action. For standalone Land, publish final " +
			"tracker evidence once " +
			"with bun run beads:sync; " +
			"an enclosing Release owns its final publication checkpoint.",
	};
}

export const machine = setup({
	types: { context: {} as Context, input: {} as Input, events: {} as Event },
	actions: {
		remember: assign(({ event }) => event.data),
		markIntegrated: assign({ alreadyIntegrated: true, timingException: false }),
		markPending: assign({ alreadyIntegrated: false, timingException: false }),
		markTiming: assign({ alreadyIntegrated: false, timingException: true }),
	},
	guards: {
		alreadyIntegrated: ({ context }) => context.alreadyIntegrated,
		timingException: ({ context }) => context.timingException,
	},
}).createMachine({
	id: "land",
	context: ({ input }) => ({
		...input,
		evidence: "",
		alreadyIntegrated: false,
		timingException: false,
	}),
	initial: "check",
	states: {
		check: {
			meta: {
				title: "Finish and check the agreed work",
				commands: {
					passed: "PASSED",
					integrated: "INTEGRATED",
					timing: "TIMING",
					blocked: "BLOCKED",
					deferred: "DEFERRED",
				},
				task: ({ context }: { context: Context }) => ({
					title: `Finish and check: ${targetTitle(context)}`,
					instructions:
						`1. Finish the agreed work for ${targetTitle(context)} and obtain Bookworm's prose review, ` +
						"including the final commit/squash message and changelog blocks under " +
						"docs/releases.md#author-tool-changelog-records.\n" +
						"2. Run bun run check on the complete change (in the canonical checkout if integrated), " +
						"recording base and content; repair failures and use the testing skill to " +
						"refactor or delete slow tests.\n" +
						"3. For unmerged work, choose timing only for valuable residual timing gates with " +
						"functional assertions and static/build " +
						"checks established; record unique coverage, measured cost, attempted fixes and " +
						"proposed allowance. " +
						"A diagnostic run may establish correctness; a timeout hiding assertions leaves it unknown, " +
						"and neither passes the normal gate.\n" +
						"4. For a green check, choose integrated with revision proof if already landed, " +
						"otherwise passed; " +
						"choose blocked when repairs cannot proceed. Already-integrated verification/adoption blockers " +
						"use deferred with the revision and next action.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				PASSED: { actions: ["remember", "markPending"], target: "librarian" },
				INTEGRATED: { actions: ["remember", "markIntegrated"], target: "librarian" },
				TIMING: { actions: ["remember", "markTiming"], target: "librarian" },
				BLOCKED: { actions: "remember", target: "preserve-draft" },
				DEFERRED: { actions: "remember", target: "merged-blocked" },
			},
		},
		librarian: {
			meta: {
				title: "Review architectural conformity",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					title: `Librarian review: ${targetTitle(context)}`,
					bee: { kind: "librarian" },
					instructions:
						`1. Review ${targetTitle(context)} at the checked base and content; ` +
						`already integrated: ${context.alreadyIntegrated} (checkout: ${context.canonicalRoot}).\n` +
						"2. Record reviewed revisions and findings; choose approved if aligned, otherwise changes.\n\n" +
						`Timing exception: ${context.timingException}; if true, assess the exception ` +
						`for a decision draft, not merge.\n` +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: { actions: "remember", target: "review" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		review: {
			meta: {
				title: "Review the checked change",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					title: `Review: ${targetTitle(context)}`,
					bee: { kind: "reviewer" },
					instructions:
						`1. Review ${targetTitle(context)} at the checked base and content; ` +
						`already integrated: ${context.alreadyIntegrated} (checkout: ${context.canonicalRoot}).\n` +
						"2. Record reviewed revisions and findings; choose changes for repairs or " +
						"missing Librarian approval " +
						"of this candidate, otherwise approved.\n\n" +
						`Timing exception: ${context.timingException}; if true, assess the exception ` +
						`for a decision draft, not merge.\n` +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: [
					{ guard: "alreadyIntegrated", actions: "remember", target: "verify" },
					{ guard: "timingException", actions: "remember", target: "reviewed-draft" },
					{ actions: "remember", target: "finish" },
				],
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		finish: {
			meta: {
				title: "Commit and land",
				commands: { next: "NEXT", changes: "CHANGES", blocked: "BLOCKED" },
				task: ({ context }: { context: Context }) => ({
					title: `Commit and land: ${targetTitle(context)}`,
					instructions:
						"1. Commit the approved content with the reviewed final message and changelog blocks; " +
						"choose changes if content or base changes beyond the review.\n" +
						`2. Land ${targetTitle(context)} through honeycomb finish --help or the PR's configured ` +
						"checks, approvals and merge policy with gh; choose next only after confirmed integration, " +
						"or blocked for provider/authorization blockers or explicit PR-only scope.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "verify" },
				BLOCKED: { actions: "remember", target: "reviewed-draft" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		verify: {
			meta: {
				title: "Verify integration and cleanup",
				commands: { next: "NEXT", changes: "CHANGES", deferred: "DEFERRED" },
				task: ({ context }: { context: Context }) => ({
					title: `Verify integration: ${targetTitle(context)}`,
					instructions:
						`1. From ${context.canonicalRoot}, verify clean synchronized main contains the intended change ` +
						"and reviewed changelog blocks, then run bun run check at the integrated commit; " +
						"choose changes if the actual final base or content differs from either review.\n" +
						"2. Verify feature-worktree cleanup, using honeycomb remove --help " +
						"with integration proof when needed; choose next when verified, or deferred " +
						"with the integrated " +
						"revision and remaining action when blocked.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "local-update" },
				DEFERRED: { actions: "remember", target: "merged-blocked" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		"local-update": {
			meta: {
				title: "Update local tools",
				commands: { next: "NEXT", deferred: "DEFERRED" },
				task: ({ context }: { context: Context }) => ({
					title: `Update local tools: ${targetTitle(context)}`,
					instructions:
						`1. From clean synchronized main in ${context.canonicalRoot}, run bun install ` +
						`--frozen-lockfile, ` +
						"then bun run --filter '*' build; install with bun run --filter '*' install:bin " +
						"only after every build succeeds.\n" +
						"2. Verify installed artifacts match the builds, resolve on PATH and pass " +
						"read-only CLI smoke checks.\n" +
						"3. Coordinate running-service refreshes with active work; " +
						"choose next after required adoption, or deferred with the integrated revision " +
						"and unfinished action.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "done" },
				DEFERRED: { actions: "remember", target: "merged-blocked" },
			},
		},
		"reviewed-draft": {
			meta: {
				title: "Publish the reviewed decision",
				commands: { published: "PUBLISHED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					title: "Publish the reviewed decision",
					instructions:
						"1. Publish or update a draft PR with the exact exception/blocker, checks, both " +
						"review references " +
						"and next decision; an otherwise merge-ready blocked or PR-only change may remain open.\n" +
						"2. Verify the PR URL and retain the worktree; choose published with evidence and pr. " +
						"Reuse unchanged reviews; changed content/base uses changes. If publication is unavailable, " +
						"leave this visit blocked with branch/commit evidence and the next action.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				PUBLISHED: { actions: "remember", target: "draft-delivered" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		"preserve-draft": {
			meta: {
				title: "Preserve blocked work",
				commands: { published: "PUBLISHED" },
				task: ({ context }: { context: Context }) => ({
					title: "Preserve blocked work",
					instructions:
						"1. Commit and publish the retained work as a draft PR marked unreviewed and " +
						"failing/unverified, " +
						"not merge-ready; include failed commands, blocker and next action.\n" +
						"2. Verify the PR URL and retain the worktree; choose published with evidence and pr. " +
						"If publication is unavailable, leave this visit blocked with branch/commit evidence.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { PUBLISHED: { actions: "remember", target: "draft-delivered" } },
		},
		"draft-delivered": { type: "final" },
		"merged-blocked": { type: "final" },
		done: { type: "final" },
	},
});

function targetTitle(input: Input): string {
	if (input.target.kind === "worktree") {
		return `worktree ${input.target.branch}`;
	}
	return `PR ${input.target.url}`;
}
