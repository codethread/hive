import { setup } from "xstate";
import { z } from "zod";

const NONEMPTY = 1;

export const inputSchema = z.object({
	worktree: z.string().min(NONEMPTY),
	request: z.string().min(NONEMPTY),
});
export const commandSchemas = { next: z.object({}) };

interface Linear {
	/** Caller-supplied execution context rendered in each stage. */
	worktree: string;
	/** Caller-supplied assignment; never invented by the worker. */
	request: string;
}

export function runBrief(input: Linear) {
	return { title: "Linear workflow", description: `${input.request} in ${input.worktree}` };
}

export const machine = setup({ types: {} as { context: Linear; input: Linear } }).createMachine({
	id: "linear",
	context: ({ input }) => input,
	initial: "stageA",
	states: {
		stageA: {
			meta: {
				title: "A",
				commands: { next: "A.DONE" },
				task: ({ context }: { context: Linear }) => ({
					instructions: `Perform A for ${context.request} in ${context.worktree}.`,
				}),
			},
			on: { "A.DONE": "stageB" },
		},
		stageB: {
			meta: {
				title: "B",
				commands: { next: "B.DONE" },
				task: ({ context }: { context: Linear }) => ({
					instructions: `Perform B for ${context.request} in ${context.worktree}.`,
				}),
			},
			on: { "B.DONE": "stageC" },
		},
		stageC: {
			meta: {
				title: "C",
				commands: { next: "C.DONE" },
				task: ({ context }: { context: Linear }) => ({
					instructions: `Perform C for ${context.request} in ${context.worktree}.`,
				}),
			},
			on: { "C.DONE": "done" },
		},
		done: { type: "final" },
	},
});
