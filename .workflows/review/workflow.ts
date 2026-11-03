import { assign, enqueueActions, sendParent, setup } from "xstate";
import { scopeInstructions, scopeSchema } from "./scope.ts";
import type { ActorRefFrom } from "xstate";
import type { ReviewJob } from "./concerns.ts";
import { jobSchema } from "./concerns.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const text = z.string().trim().min(ONE);
export const inputSchema = z
	.object({
		scope: scopeSchema,
		jobs: z.array(jobSchema),
	})
	.refine(
		({ scope, jobs }) =>
			new Set(jobs.map((job) => job.id)).size === jobs.length &&
			jobs.every((job) => job.files.every((file) => scope.files.includes(file))),
		{
			message: "Review jobs need unique IDs and files within the selected scope",
		},
	);
const findingSchema = z.object({
	category: z.enum(["violation", "suggestion"]),
	severity: z.enum(["high", "medium", "low"]),
	location: text.describe("Repository-relative path:line"),
	standard: text.describe("Exact rule/specification source; suggestions are not violations"),
	problem: text,
	fix: text,
});
export const resultSchema = z.object({
	choice: z.literal("reviewed"),
	evidence: z.array(text).min(ONE).describe("Actual source inspection or focused check results"),
	findings: z.array(findingSchema),
	notVerified: z
		.array(text)
		.describe("Missing evidence or checks; empty only when the assigned review is complete"),
});
export const commandSchemas = { reviewed: resultSchema };
export type ReviewInput = z.infer<typeof inputSchema>;
type ReviewResult = z.infer<typeof resultSchema>;
interface ReviewerContext {
	/** Selected input scope, not an isolated checkout or captured file contents. */
	scope: ReviewInput["scope"];
	/** Concern, standards sources and assigned paths for this bee. */
	job: ReviewJob;
	/** Busy Bee container for this child actor. */
	group: string;
}
interface ReviewContext extends ReviewInput {
	/** Accepted review evidence keyed by concern ID. */
	results: Record<string, ReviewResult>;
	/** Active child actors excluded from projected task context. */
	workers: ActorRefFrom<typeof reviewer>[];
}
interface ReviewEvent {
	/** One closed review task's accepted result. */
	type: "REVIEW.RESULT";
	/** Stable concern ID assigned by the workflow. */
	id: string;
	/** Validated worker report. */
	result: ReviewResult;
}

export const reviewer = setup({
	actions: {
		report: sendParent(({ context, event }) => ({
			id: context.job.id,
			result: resultSchema.parse(event.data),
			type: "REVIEW.RESULT",
		})),
	},
	types: {
		context: {} as ReviewerContext,
		input: {} as ReviewerContext,
		events: {} as { type: "REVIEWED"; data: unknown },
	},
}).createMachine({
	id: "scoped-reviewer",
	context: ({ input }) => input,
	initial: "review",
	states: {
		review: {
			meta: {
				title: "Review concern",
				commands: { reviewed: "REVIEWED" },
				task: ({ context }: { context: ReviewerContext }) => ({
					title: context.job.title,
					bee: { kind: context.job.kind },
					instructions: [
						`Review concern: ${context.job.id}\nAxis: ${context.job.axis}`,
						scopeInstructions(context.scope),
						`Assigned repository-relative paths (quote paths in shell commands):\n${context.job.files.map((file) => JSON.stringify(file)).join("\n")}`,
						`Read these governing sources:\n${context.job.sources.join("\n")}`,
						context.job.focus,
						"This is a scoped advisory review, not permission to edit, commit, curate documentation or approve landing. Read surrounding contracts as needed; distinguish new changes from unchanged context. The caller owns overlapping edits. Report findings only; do not fix files or create implementation tasks.",
						"Stay within this concern. Cite exact standards/requirements for violations and distinguish suggestions. Reuse supplied check evidence; run only useful focused checks, not the full suite. Record unavailable evidence in notVerified instead of inventing results. A completed review may have findings.",
						"Discover the reviewed outcome schema below. Save one JSON result in task notes and close your task; the calling agent collects results. Leave run/group beads alone.",
					].join("\n\n"),
				}),
			},
			on: { REVIEWED: { actions: "report", target: "done" } },
		},
		done: { type: "final" },
	},
});

export const machine = setup({
	actors: { reviewer },
	actions: {
		spawnReviews: assign({
			workers: ({ context, spawn }) =>
				context.jobs.map((job) =>
					spawn("reviewer", {
						id: job.id,
						input: { group: "scoped-review.reviews", job, scope: context.scope },
					}),
				),
		}),
		collect: assign({
			results: ({ context, event }) => ({ ...context.results, [event.id]: event.result }),
		}),
		stopReviews: enqueueActions(({ context, enqueue }) => {
			for (const worker of context.workers) {
				enqueue.stopChild(worker);
			}
			enqueue.assign({ workers: [] });
		}),
	},
	guards: {
		allReported: ({ context }) => Object.keys(context.results).length === context.jobs.length,
	},
	types: { context: {} as ReviewContext, input: {} as ReviewInput, events: {} as ReviewEvent },
}).createMachine({
	id: "scoped-review",
	context: ({ input }) => ({ ...input, results: {}, workers: [] }),
	initial: "reviews",
	output: ({ context }) => reviewReport(context),
	states: {
		reviews: {
			entry: "spawnReviews",
			exit: "stopReviews",
			always: { guard: "allReported", target: "done" },
			meta: {
				title: "Specialist reviews",
				task: ({ context }: { context: ReviewContext }) => ({
					instructions: `Wait for all ${context.jobs.length} selected concern reviews, then collect their results. The caller owns edits and subsequent fixes. This group has no worker.`,
				}),
			},
			on: { "REVIEW.RESULT": { actions: "collect" } },
		},
		done: { type: "final" },
	},
});

export function runBrief(input: ReviewInput) {
	return {
		title: `Review ${input.scope.kind}: ${input.scope.files.length} files`,
		description: `${scopeInstructions(input.scope)}\n\nConcerns: ${input.jobs.map((job) => job.id).join(", ") || "none matched"}. Read-only review; the caller owns concurrent edits and repairs.`,
	};
}

export const inputConstraints =
	"Use the workflow's submit helper to resolve Git/file scope and select concerns. No concurrency isolation is performed.";

// --- Private functions ---

function reviewReport(context: ReviewContext) {
	const standards = context.jobs.filter((job) => job.axis === "standards");
	const spec = context.jobs.filter((job) => job.axis === "spec");
	const covered = new Set(standards.flatMap((job) => job.files));
	const unmatchedFiles = context.scope.files.filter((file) => !covered.has(file));
	return {
		scope: context.scope,
		coverage: {
			concerns: context.jobs.map(({ id, axis, files }) => ({ id, axis, files })),
			unmatchedFiles,
		},
		standards: axisReport(
			standards,
			context.results,
			unmatchedFiles.map((file) => `No standards concern matched ${file}`),
		),
		spec: specReport(spec, context.results),
	};
}

function specReport(jobs: ReviewJob[], results: ReviewContext["results"]) {
	if (jobs.length === ZERO) {
		return { verdict: "not_requested", reviews: [] };
	}
	return axisReport(jobs, results, []);
}

function axisReport(jobs: ReviewJob[], results: ReviewContext["results"], uncovered: string[]) {
	const reviews = jobs.map((job) => ({ concern: job.id, ...results[job.id]! }));
	const findings = reviews.flatMap((review) =>
		review.findings.map((finding) => ({ concern: review.concern, ...finding })),
	);
	const notVerified = [...uncovered, ...reviews.flatMap((review) => review.notVerified)];
	let verdict = "clear";
	if (notVerified.length > ZERO) {
		verdict = "incomplete";
	} else if (findings.length > ZERO) {
		verdict = "findings";
	}
	return { verdict, reviews, findings, notVerified };
}
