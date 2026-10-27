import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const checkoutSchema = z.object({ path: text.startsWith("/"), branch: text });
const evidenceSchema = z.object({ evidence: text });
const publicationSchema = evidenceSchema.extend({ pr: z.url() });

export const inputSchema = z.object({
	canonicalRoot: text.startsWith("/"),
	base: checkoutSchema,
	isolation: checkoutSchema,
});
export const commandSchemas = {
	next: evidenceSchema,
	approved: evidenceSchema,
	changes: evidenceSchema,
	timing: evidenceSchema,
	blocked: evidenceSchema,
	published: publicationSchema,
};

type Input = z.infer<typeof inputSchema>;
interface Context extends Input {
	/** Evidence from the preceding visit; the native visits retain the full audit trail. */
	evidence: string;
	/** A retained timing exception requires a reviewed PR instead of feature-base integration. */
	timingException: boolean;
}
interface Event {
	/** Outcome mapped by the active task. */
	type: "NEXT" | "APPROVED" | "CHANGES" | "TIMING" | "BLOCKED" | "PUBLISHED";
	/** Original outcome parsed by Busy Bee at submission. */
	data: z.infer<typeof evidenceSchema>;
}

export const resumeSchema = inputSchema.extend({
	evidence: z.string(),
	timingException: z.boolean(),
});

export function runBrief(input: Input): { title: string; description: string } {
	return {
		title: `Deliver feature task ${input.isolation.branch}`,
		description:
			`Control checkout: ${input.canonicalRoot}. done proves integration into ${input.base.branch}; ` +
			"draft-delivered does not satisfy integration acceptance. Close only proven source " +
			"scope; retain draft " +
			"worktrees and unmet criteria. Name the parent feature coordinator/task in the handoff: it owns " +
			"combined Land delivery to main or a blocked PR.",
	};
}

export const machine = setup({
	types: { context: {} as Context, input: {} as Input, events: {} as Event },
	actions: {
		remember: assign(({ event }) => event.data),
		markClean: assign({ timingException: false }),
		markTiming: assign({ timingException: true }),
	},
	guards: { timingException: ({ context }) => context.timingException },
}).createMachine({
	id: "do-feature-task",
	context: ({ input }) => ({ ...input, evidence: "", timingException: false }),
	initial: "prepare",
	states: {
		prepare: {
			meta: {
				title: "Isolate the task",
				commands: { next: "NEXT" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`Use Honeycomb to create or resume ${context.isolation.branch} at ${context.isolation.path} ` +
						`from current ${context.base.branch} in ${context.base.path}; both worktrees must be ` +
						"distinct from the canonical checkout and default branch.",
				}),
			},
			on: { NEXT: { actions: "remember", target: "work" } },
		},
		work: {
			meta: {
				title: "Implement and check",
				commands: { next: "NEXT", timing: "TIMING", blocked: "BLOCKED" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`1. Finish the assigned change and Bookworm's prose review in ${context.isolation.path}.\n` +
						"2. Run bun run check, recording base and content; repair failures and use the testing skill " +
						"to refactor or delete slow tests.\n" +
						"3. Choose next for a green check; timing only for valuable residual timing " +
						"gates with functional " +
						"assertions and static/build checks established, recording unique coverage, " +
						"measured cost, attempted " +
						"fixes and proposed allowance; otherwise blocked when repairs cannot proceed. A " +
						"diagnostic run may " +
						"establish correctness; a timeout hiding assertions leaves it unknown, and " +
						"neither passes the normal gate.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: ["remember", "markClean"], target: "librarian" },
				TIMING: { actions: ["remember", "markTiming"], target: "librarian" },
				BLOCKED: { actions: "remember", target: "preserve-draft" },
			},
		},
		librarian: {
			meta: {
				title: "Review architectural conformity",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					bee: { kind: "librarian" },
					instructions:
						`1. Review the checked base and content in ${context.isolation.path}.\n` +
						"2. Record reviewed revisions and findings; choose approved if aligned, otherwise changes.\n\n" +
						`Timing exception: ${context.timingException}; if true, assess the exception for a ` +
						`decision draft, not integration.\n` +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: { actions: "remember", target: "review" },
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		review: {
			meta: {
				title: "Review the checked change",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					bee: { kind: "reviewer" },
					instructions:
						`1. Review the checked base and content in ${context.isolation.path}.\n` +
						"2. Record reviewed revisions and findings; choose changes for repairs or " +
						"missing Librarian approval " +
						"of this candidate, otherwise approved.\n\n" +
						`Timing exception: ${context.timingException}; if true, assess the exception for a ` +
						`decision draft, not integration.\n` +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: [
					{ guard: "timingException", actions: "remember", target: "reviewed-draft" },
					{ actions: "remember", target: "deliver" },
				],
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		deliver: {
			meta: {
				title: "Integrate and clean up",
				commands: { next: "NEXT", changes: "CHANGES", blocked: "BLOCKED" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`1. Commit the approved content in ${context.isolation.path}, then integrate into ` +
						`${context.base.branch} at ${context.base.path} following honeycomb integrate --help; ` +
						"choose changes if content/base changed, or blocked for provider/authorization " +
						"blockers or PR-only scope.\n" +
						"2. Verify local integration before removing the isolated worktree with " +
						"honeycomb remove --help; " +
						"hand off to the parent feature coordinator for combined Land delivery.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "done" },
				BLOCKED: { actions: "remember", target: "reviewed-draft" },
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		"reviewed-draft": {
			meta: {
				title: "Publish the reviewed feature task",
				commands: { published: "PUBLISHED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`1. Publish/update a draft PR from ${context.isolation.branch} to ` +
						`${context.base.branch} with the ` +
						"exception/blocker, checks, both review references and next decision; otherwise merge-ready " +
						"blocked or PR-only work may remain open.\n" +
						"2. Verify the URL and retain the worktree; choose published with evidence and pr, or changes " +
						"if content/base changed. If this base cannot be published, leave the visit blocked with " +
						"branch/commit evidence and next action; never retarget main.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				PUBLISHED: { actions: "remember", target: "draft-delivered" },
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		"preserve-draft": {
			meta: {
				title: "Preserve the blocked feature task",
				commands: { published: "PUBLISHED" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`1. Commit and publish a draft PR from ${context.isolation.branch} to ${context.base.branch}, ` +
						"marked unreviewed and failing/unverified, not merge-ready; include failed " +
						"commands, blocker and next action.\n" +
						"2. Verify the URL and retain the worktree; choose published with evidence and " +
						"pr. If this base " +
						"cannot be published, leave the visit blocked with branch/commit evidence; " +
						"never retarget main.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { PUBLISHED: { actions: "remember", target: "draft-delivered" } },
		},
		"draft-delivered": { type: "final" },
		done: { type: "final" },
	},
});
