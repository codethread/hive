import { assertEvent, assign, enqueueActions, sendParent, setup } from "xstate";
import type { ActorRefFrom } from "xstate";
import { z } from "zod";

const ONE = 1;
const ZERO = 0;
const text = z.string().trim().min(ONE);

const executionSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("manual") }),
	z.object({ kind: text, mode: z.literal("bee") }),
]);
export const inputSchema = z.object({
	base: z
		.string()
		.regex(/^[a-f\d]{40}$/u)
		.describe("Full base commit SHA; compare the cumulative diff against this commit"),
	execution: executionSchema,
	request: text.describe("Requested outcome and scope"),
	title: text.describe("Readable name of the change"),
});

const taskSchema = z.object({
	checks: z.array(text).min(ONE).describe("Required inspections or executable checks"),
	files: z.array(text).min(ONE).describe("Assigned repository-relative file paths"),
	id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
	instructions: text.describe("Concrete review instructions derived from the actual change"),
	title: text,
});

export const planSchema = z
	.object({
		choice: z.literal("planned"),
		revision: text.describe(
			"Fingerprint of the reviewed diff; reviewers must match their assigned revision",
		),
		summary: text.describe("Concrete summary and supporting rationale"),
		tasks: z.array(taskSchema).min(ONE),
	})
	.refine((plan) => new Set(plan.tasks.map((task) => task.id)).size === plan.tasks.length, {
		message: "Review task IDs must be unique within a round",
	});

const findingSchema = z.object({
	fix: text,
	location: text,
	problem: text,
	verification: text,
});
export const resultSchema = z.discriminatedUnion("choice", [
	z.object({
		choice: z.literal("approved"),
		evidence: z
			.array(text)
			.min(ONE)
			.describe("Actual inspection/check results, including failures"),
		findings: z.array(findingSchema).length(ZERO),
		revision: text.describe(
			"Fingerprint of the reviewed diff; reviewers must match their assigned revision",
		),
	}),
	z.object({
		choice: z.literal("changes"),
		evidence: z
			.array(text)
			.min(ONE)
			.describe("Actual inspection/check results, including failures"),
		findings: z.array(findingSchema).min(ONE),
		revision: text.describe(
			"Fingerprint of the reviewed diff; reviewers must match their assigned revision",
		),
	}),
]);

export const repairSchema = z.object({
	choice: z.literal("repaired"),
	summary: text.describe("Concrete summary and supporting rationale"),
	verification: z
		.array(text)
		.min(ONE)
		.describe("Checks performed after repair and their observed results"),
});

type Change = z.infer<typeof inputSchema>;
type Plan = z.infer<typeof planSchema>;
type ReviewResult = z.infer<typeof resultSchema>;

interface ReviewContext extends Change {
	/** Planner-authored job for this actor. */
	task: Plan["tasks"][number];
	/** Current review round. */
	round: number;
	/** Assigned diff identity. */
	revision: string;
	/** Containing XState node. */
	group: string;
}

interface ReviewState {
	/** Immutable requested change. */
	change: Change;
	/** Incremented after each repair. */
	round: number;
	/** Current planner result once planning is complete. */
	plan: Plan | undefined;
	/** Collected results keyed by planned task ID. */
	results: Record<string, ReviewResult>;
	/** Prior round evidence for replanning. */
	previous:
		| {
				plan: Plan;
				results: Record<string, ReviewResult>;
				repair: z.infer<typeof repairSchema>;
		  }
		| undefined;
	/** Spawned actors stopped when leaving the round. */
	workers: ActorRefFrom<typeof reviewer>[];
}

interface ReviewEvent {
	type: "approved" | "changes";
	data: unknown;
}

type ChangeEvent =
	| { type: "PLANNED"; data: unknown }
	| { type: "REPAIRED"; data: unknown }
	| { type: "REVIEW.RESULT"; id: string; result: ReviewResult };

// One actor per planner-authored brief. No file classifier or job catalogue in the chart.
export const reviewer = setup({
	actions: {
		report: sendParent(({ context, event }) => {
			const result = resultSchema.parse(event.data);
			if (result.revision !== context.revision || result.choice !== event.type) {
				throw new Error("Review result must match its assigned revision and selected choice");
			}
			return { id: context.task.id, result, type: "REVIEW.RESULT" };
		}),
	},
	types: { context: {} as ReviewContext, events: {} as ReviewEvent, input: {} as ReviewContext },
}).createMachine({
	context: ({ input }) => input,
	id: "change-reviewer",
	initial: "review",
	states: {
		done: { type: "final" },
		review: {
			meta: {
				title: "Review change",
				commands: { approved: "approved", changes: "changes" },
				// Helpers format shared runtime data; the task's authored instructions stay visible here.
				task: ({ context }: { context: ReviewContext }) => ({
					title: context.task.title,
					...assignment(context.execution),
					files: context.task.files,
					instructions: [
						changeBrief(context),
						`Round: ${context.round}\nAssigned revision: ${context.revision}\nReview task: ${context.task.id}`,
						context.task.instructions,
						`Assigned files:\n${context.task.files.map((file) => `- ${file}`).join("\n")}`,
						`Required checks:\n${context.task.checks.map((check) => `- ${check}`).join("\n")}`,
						"Read surrounding contracts as needed. Do not modify files: other " +
							"reviewers share this checkout. Report evidence, including checks " +
							"that failed. A completed review may request changes; closing this " +
							"task does not mean approval.",
						"Discover the approved and changes result contracts with the task discovery command below.",
					].join("\n\n"),
				}),
			},
			on: {
				approved: { actions: "report", target: "done" },
				changes: { actions: "report", target: "done" },
			},
		},
	},
});

export const machine = setup({
	actions: {
		acceptPlan: assign(({ event }) => {
			assertEvent(event, "PLANNED");
			return { plan: planSchema.parse(event.data), results: {} };
		}),
		collect: assign({
			results: ({ context, event }) => {
				assertEvent(event, "REVIEW.RESULT");
				return { ...context.results, [event.id]: event.result };
			},
		}),
		recordRepair: assign(({ context, event }) => {
			assertEvent(event, "REPAIRED");
			return {
				previous: {
					plan: context.plan!,
					repair: repairSchema.parse(event.data),
					results: context.results,
				},
				round: context.round + ONE,
			};
		}),
		spawnReviews: assign({
			workers: ({ context, spawn }) =>
				context.plan!.tasks.map((task) =>
					spawn("reviewer", {
						id: `round-${context.round}-${task.id}`,
						input: {
							...context.change,
							group: "change-review.review",
							revision: context.plan!.revision,
							round: context.round,
							task,
						},
					}),
				),
		}),
		stopReviews: enqueueActions(({ context, enqueue }) => {
			for (const worker of context.workers) {
				enqueue.stopChild(worker);
			}
			enqueue.assign({ workers: [] });
		}),
	},
	actors: { reviewer },
	guards: {
		allReported: ({ context }) =>
			Object.keys(context.results).length === context.plan!.tasks.length,
		hasFindings: ({ context }) =>
			Object.values(context.results).some((result) => result.choice === "changes"),
	},
	types: { context: {} as ReviewState, events: {} as ChangeEvent, input: {} as Change },
}).createMachine({
	context: ({ input }) => ({
		change: inputSchema.parse(input),
		plan: undefined,
		previous: undefined,
		results: {},
		round: 1,
		workers: [],
	}),
	id: "change-review",
	initial: "plan",
	states: {
		decide: { always: [{ guard: "hasFindings", target: "repair" }, { target: "done" }] },
		done: { type: "final" },
		plan: {
			meta: {
				title: "Plan reviews",
				commands: { planned: "PLANNED" },
				task: ({ context }: { context: ReviewState }) => ({
					title: `Plan reviews: ${context.change.title} (round ${context.round})`,
					...assignment(context.change.execution),
					instructions: [
						changeBrief(context.change),
						"Inspect the actual cumulative diff against the base above, " +
							"surrounding code, repository rules and tests. Include staged, " +
							"unstaged and relevant untracked files; use git status --short " +
							"--untracked-files=all as well as git diff. Do not edit the change.",
						"Choose the review tasks this specific change needs. Each task must " +
							"explain its concrete risk, assigned files, what to inspect or run, " +
							"and evidence required for completion. Reviewers run concurrently and " +
							"must not modify files. Cover the whole change; do not use a fixed " +
							"docs/API/tests checklist or invent findings. Use a distinct task ID " +
							"for each brief.",
						"Record a revision fingerprint identifying the diff you inspected " +
							"(for example a SHA-256 of the cumulative patch and relevant " +
							"untracked contents). Keep the checkout unchanged during a review " +
							"round.",
						previousBrief(context.previous),
						"Discover the planned result contract with the task discovery command below.",
					].join("\n\n"),
				}),
			},
			on: { PLANNED: { actions: "acceptPlan", target: "review" } },
		},
		repair: {
			meta: {
				title: "Repair findings",
				commands: { repaired: "REPAIRED" },
				task: ({ context }: { context: ReviewState }) => ({
					title:
						"Repair " +
						`${context.plan!.tasks.reduce(
							(count, task) => count + context.results[task.id]!.findings.length,
							ZERO,
						)}` +
						` findings: ${context.change.title}`,
					...assignment(context.change.execution),
					instructions: [
						changeBrief(context.change),
						`Repair the findings from round ${context.round}, revision ` +
							`${context.plan!.revision}` +
							". All reviewers have finished; this is the sole task that may edit " +
							"the change.",
						...context.plan!.tasks.flatMap((task) =>
							context.results[task.id]!.findings.map((finding) =>
								[
									`From ${task.title} (${task.id}) — ${finding.location}`,
									`Problem: ${finding.problem}`,
									`Requested fix: ${finding.fix}`,
									`Verify: ${finding.verification}`,
								].join("\n"),
							),
						),
						"Make the smallest coherent fixes, add meaningful regression coverage " +
							"where needed, and run the checks above. Do not mark repaired while a " +
							"finding remains unresolved. Report actual command results, not " +
							"planned verification. Do not commit, push or publish the change.",
						"Discover the repaired result contract with the task discovery " +
							"command below. The next planner inspects the new cumulative diff.",
					].join("\n\n"),
				}),
			},
			on: { REPAIRED: { actions: "recordRepair", target: "plan" } },
		},
		review: {
			always: { guard: "allReported", target: "decide" },
			entry: "spawnReviews",
			exit: "stopReviews",
			meta: {
				title: "Review round",
				task: ({ context }: { context: ReviewState }) => ({
					title: `Review round ${context.round}: ${context.change.title}`,
					instructions:
						`${context.plan!.summary}\n\nRevision: ` +
						`${context.plan!.revision}\nWait for all ` +
						`${context.plan!.tasks.length} reviews. This grouping bead has no worker.`,
				}),
			},
			on: { "REVIEW.RESULT": { actions: "collect" } },
		},
	},
});

function previousBrief(previous: ReviewState["previous"]): string {
	if (!previous) {
		return "This is the first review round.";
	}
	return (
		`Previous repair: ${previous.repair.summary}\nVerification:\n` +
		`${previous.repair.verification.join("\n")}\nPrevious findings to verify again:\n` +
		`${Object.values(previous.results)
			.flatMap((result) =>
				result.findings.map(
					(finding) =>
						`${finding.location}: ${finding.problem}; fix: ${finding.fix}; verify: ${finding.verification}`,
				),
			)
			.join("\n")}`
	);
}

function changeBrief(change: Change) {
	return (
		`Change: ${change.title}\n\nRequested outcome:\n` +
		`${change.request}\n\nCompare against base commit: ` +
		`${change.base}`
	);
}

function assignment(execution: Change["execution"]): { bee?: { kind: string } } {
	if (execution.mode === "bee") {
		return { bee: { kind: execution.kind } };
	}
	return {};
}

// These are the same schemas used by chart actions and by the runner boundary.
export const commandSchemas = {
	approved: resultSchema.options[ZERO],
	changes: resultSchema.options[ONE],
	planned: planSchema,
	repaired: repairSchema,
};

export function validateCommand(
	entry: { context: Record<string, unknown> },
	command: string,
	data: unknown,
) {
	const schemas: Record<string, z.ZodType> = commandSchemas;
	const result = z
		.object({ choice: z.string(), revision: z.string().optional() })
		.passthrough()
		.parse(schemas[command]!.parse(data));
	if (result.choice !== command) {
		throw new Error("Payload choice must match selected command");
	}
	if (
		(command === "approved" || command === "changes") &&
		result.revision !== entry.context["revision"]
	) {
		throw new Error(`Review revision must equal assigned revision ${entry.context["revision"]}`);
	}
	return result;
}

export function runBrief(input: Change) {
	return {
		description: `${input.request}\n\nBase commit: ${input.base}`,
		title: `Change review: ${input.title}`,
	};
}

export const inputConstraints = "Text fields are trimmed and must remain nonempty.";
export function describe(entry: { context: Record<string, unknown> }) {
	return {
		constraints:
			"Text fields are trimmed and must remain nonempty. Review task IDs " +
			"must be unique in each plan. Review revisions must equal the " +
			"assigned revision shown on the task.",
		revision: entry.context["revision"],
	};
}
