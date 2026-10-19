import { assign, setup } from "xstate";
import { z } from "zod";

const text = z.string().trim().nonempty();
const evidenceSchema = z.object({ evidence: text });
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
	integrated: evidenceSchema,
	approved: evidenceSchema,
	changes: evidenceSchema,
	next: evidenceSchema,
};

type Input = z.infer<typeof inputSchema>;
interface Context extends Input {
	/** Latest visit evidence; earlier checks and reviews remain on their native beads. */
	evidence: string;
}
interface Event {
	/** Outcome mapped by the active task. */
	type: "PASSED" | "INTEGRATED" | "APPROVED" | "CHANGES" | "NEXT";
	/** Original outcome parsed by Busy Bee at submission. */
	data: z.infer<typeof evidenceSchema>;
}

export const resumeSchema = inputSchema.extend({ evidence: z.string() });

export function runBrief(input: Input): { title: string; description: string } {
	return {
		title: `Land ${targetTitle(input)}`,
		description:
			`User authorization: ${input.request}\nRetain ${input.canonicalRoot} and BEADS_DB ${input.beadsDb}. ` +
			`After done, the authorized caller closes proven completedTasks: ${input.completedTasks.join(", ") || "none"}. ` +
			"For standalone Land, publish final tracker evidence once with bun run beads:sync; " +
			"an enclosing Release owns its final publication checkpoint.",
	};
}

export const machine = setup({
	types: { context: {} as Context, input: {} as Input, events: {} as Event },
	actions: { remember: assign(({ event }) => event.data) },
}).createMachine({
	id: "land",
	context: ({ input }) => ({ ...input, evidence: "" }),
	initial: "check",
	states: {
		check: {
			meta: {
				title: "Finish and check the agreed work",
				commands: { passed: "PASSED", integrated: "INTEGRATED" },
				task: ({ context }: { context: Context }) => ({
					title: `Finish and check: ${targetTitle(context)}`,
					instructions:
						`1. Finish the agreed work for ${targetTitle(context)} and required specialist passes, ` +
						"including Bookworm review of final changelog blocks under " +
						"docs/releases.md#author-tool-changelog-records. " +
						"If already landed, choose integrated with proof.\n" +
						"2. Run bun run check on the complete change and record the checked base and content before passed.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				PASSED: { actions: "remember", target: "review" },
				INTEGRATED: { actions: "remember", target: "verify" },
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
						`Review the complete checked change for ${targetTitle(context)} against acceptance and repository ` +
						"standards; record the reviewed base, content and findings, choosing approved or changes.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				APPROVED: { actions: "remember", target: "finish" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		finish: {
			meta: {
				title: "Commit and land",
				commands: { next: "NEXT", changes: "CHANGES" },
				task: ({ context }: { context: Context }) => ({
					title: `Commit and land: ${targetTitle(context)}`,
					instructions:
						"1. Commit the approved content with the reviewed final message and changelog blocks; " +
						"choose changes if content or base changes beyond the review.\n" +
						`2. Land ${targetTitle(context)} through honeycomb finish --help or the PR's configured ` +
						"checks, approvals and merge policy with gh; choose next only after integration is confirmed.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: {
				NEXT: { actions: "remember", target: "verify" },
				CHANGES: { actions: "remember", target: "check" },
			},
		},
		verify: {
			meta: {
				title: "Verify integration and cleanup",
				commands: { next: "NEXT" },
				task: ({ context }: { context: Context }) => ({
					title: `Verify integration: ${targetTitle(context)}`,
					instructions:
						`1. From ${context.canonicalRoot}, verify clean synchronized main contains the intended change ` +
						"and reviewed changelog blocks, then run bun run check at the integrated commit.\n" +
						"2. Verify feature-worktree cleanup, using honeycomb remove --help " +
						"with integration proof when needed.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "remember", target: "local-update" } },
		},
		"local-update": {
			meta: {
				title: "Update local tools",
				commands: { next: "NEXT" },
				task: ({ context }: { context: Context }) => ({
					title: `Update local tools: ${targetTitle(context)}`,
					instructions:
						`1. From clean synchronized main in ${context.canonicalRoot}, run bun install --frozen-lockfile, ` +
						"then bun run --filter '*' build; install with bun run --filter '*' install:bin " +
						"only after every build succeeds.\n" +
						"2. Verify installed artifacts match the builds, resolve on PATH and pass read-only CLI smoke checks.\n" +
						"3. Coordinate running-service refreshes with active work; " +
						"record the installed revision and any restart deferral.\n\n" +
						`Previous result: ${context.evidence}`,
				}),
			},
			on: { NEXT: { actions: "remember", target: "done" } },
		},
		done: { type: "final" },
	},
});

function targetTitle(input: Input): string {
	if (input.target.kind === "worktree") {
		return `worktree ${input.target.branch}`;
	}
	return `PR ${input.target.url}`;
}
