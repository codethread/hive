import { setup } from "xstate";
import { z } from "zod";

const NONEMPTY = 1;

export const inputSchema = z.object({
	title: z.string().trim().min(NONEMPTY),
	request: z.string().trim().min(NONEMPTY),
	acceptance: z.array(z.string().trim().min(NONEMPTY)).min(NONEMPTY),
});
export const commandSchemas = { next: z.object({}) };

interface Work {
	/** Assignment title used by the work stage and contextual run title. */
	title: string;
	/** The actual assignment performed in this workflow. */
	request: string;
	/** Caller-defined verification required before completing the work stage. */
	acceptance: string[];
}

export function runBrief(input: Work) {
	return {
		title: `Do work: ${input.title}`,
		description: input.request,
	};
}

export const machine = setup({ types: {} as { context: Work; input: Work } }).createMachine({
	id: "do-work",
	context: ({ input }) => input,
	initial: "work",
	states: {
		work: {
			meta: {
				title: "Do work",
				commands: { next: "COMPLETED" },
				task: ({ context }: { context: Work }) => ({
					title: context.title,
					instructions:
						`${
							context.request
						}\n\n1. Deliver within scope: reports end with the report; delegated code contributes to the parent ` +
						`coordinator's delivery; authorized top-level implementation follows this repository's delivery ` +
						`workflow to merge by default, or a draft/open PR when blocked or explicitly PR-only.\n` +
						`2. Verify caller acceptance; a draft does not satisfy required integration. Leave unmet work open ` +
						`with its blocker and next action.`,
					acceptanceCriteria: context.acceptance
						.map((criterion) => `- [ ] ${criterion}`)
						.join("\n"),
				}),
			},
			on: { COMPLETED: "done" },
		},
		done: { type: "final" },
	},
});
