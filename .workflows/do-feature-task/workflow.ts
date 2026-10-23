import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const checkoutSchema = z.object({ path: text.startsWith("/"), branch: text });
const evidenceSchema = z.object({ evidence: text });

export const inputSchema = z.object({
	canonicalRoot: text.startsWith("/"),
	base: checkoutSchema,
	isolation: checkoutSchema,
});
export const commandSchemas = {
	next: evidenceSchema,
	approved: evidenceSchema,
	changes: evidenceSchema,
};

type Input = z.infer<typeof inputSchema>;
interface Context extends Input {
	/** Evidence from the preceding visit; the native visits retain the full audit trail. */
	evidence: string;
}
interface Event {
	/** Outcome mapped by the active task. */
	type: "NEXT" | "APPROVED" | "CHANGES";
	/** Original outcome parsed by Busy Bee at submission. */
	data: z.infer<typeof evidenceSchema>;
}

export const resumeSchema = inputSchema.extend({ evidence: z.string() });

export function runBrief(input: Input): { title: string; description: string } {
	return {
		title: `Deliver feature task ${input.isolation.branch}`,
		description:
			`Control checkout: ${input.canonicalRoot}. After done, the authorized driver closes ` +
			"the satisfied source task; feature-wide acceptance, main landing and publication remain separate.",
	};
}

export const machine = setup({
	types: { context: {} as Context, input: {} as Input, events: {} as Event },
	actions: { remember: assign(({ event }) => event.data) },
}).createMachine({
	id: "do-feature-task",
	context: ({ input }) => ({ ...input, evidence: "" }),
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
				commands: { next: "NEXT" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`Complete the assigned change in ${context.isolation.path}, including requested repairs, ` +
						"then run bun run check and record the checked base commit and content before review.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "remember", target: "librarian" } },
		},
		librarian: {
			meta: {
				title: "Review architectural conformity",
				commands: { approved: "APPROVED", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					bee: { kind: "librarian" },
					instructions:
						`Review the final checked change in ${context.isolation.path} against established architecture and ` +
						"settled user intent; route new or unresolved architectural decisions to Architect. Record the " +
						"base commit, reviewed commit or diff, findings and response ID. " +
						"Choose approved for an aligned verdict; otherwise changes.\n\n" +
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
						`Review the complete change in ${context.isolation.path} against acceptance and repository ` +
						"standards. Record the base commit, reviewed commit or diff and findings. " +
						"Choose changes for required repairs or missing Librarian approval of the same base and content; " +
						"otherwise approved.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: { actions: "remember", target: "deliver" },
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		deliver: {
			meta: {
				title: "Integrate and clean up",
				commands: { next: "NEXT", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					instructions:
						`1. Commit the approved content in ${context.isolation.path}, then integrate into ` +
						`${context.base.branch} at ${context.base.path} following honeycomb integrate --help; ` +
						"choose changes if content or base changes beyond the review.\n" +
						"2. Verify local integration and remove the isolated worktree following honeycomb remove --help.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "done" },
				CHANGES: { actions: "remember", target: "work" },
			},
		},
		done: { type: "final" },
	},
});
