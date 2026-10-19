import type { WorkReviewCommands, WorkReviewContinuation } from "./work-review-runtime.ts";
import { colonyEntry, entryCommand } from "./executables.ts";
import { CommandError } from "@hive/beads";
import type { NurseProcess } from "./nurse-commands.ts";
import type { RepositoryEndpoint } from "@hive/shared";
import { WorkReviewError } from "./work-review.ts";
import { WorkReviewPublicationError } from "./work-review-runtime.ts";
import { workflowInspectionSchema } from "@hive/shared";
import { z } from "zod";

const NONE = 0;
const replacementIdsSchema = z.array(z.string());
const failureEffectsSchema = z.compile(
	z.object({
		runId: z.string().optional(),
		requestId: z.string().optional(),
		replacementIds: replacementIdsSchema.optional(),
	}),
);
const submissionSchema = z.object({
	ok: z.literal(true),
	request: z.object({ id: z.string() }),
	workflow: z.object({ runId: z.string() }),
});
const retrySchema = z.object({ ok: z.literal(true), request: z.object({ id: z.string() }) });
const showSchema = z.object({ ok: z.literal(true), status: z.string() });
const inspectionActorSchema = workflowInspectionSchema.shape.actors.element;
const savedActorSchema = inspectionActorSchema.omit({ id: true, machine: true }).extend({
	snapshot: inspectionActorSchema.shape.snapshot.pick({ status: true }),
});
const inspectionSchema = z.compile(
	workflowInspectionSchema.omit({ title: true, actors: true }).extend({
		ok: z.literal(true),
		kind: z.literal("workflow_inspection"),
		actors: z.array(savedActorSchema),
	}),
);
const alertSchema = z.object({
	ok: z.literal(true),
	database: z.string(),
	alert: z.object({ state: z.enum(["active", "cleared"]) }).nullable(),
});
/* eslint-disable unicorn/max-nested-calls -- Preserve the public explanation evidence structure at its parser. */
const processSchema = z.compile(
	z.object({
		ok: z.literal(true),
		id: z.string(),
		repository: z.object({ root: z.string(), beadsDb: z.string() }),
		tracker: z.object({
			result: z.object({
				kind: z.literal("available"),
				value: z.object({ identity: z.string(), tasks: z.array(z.object({ id: z.string() })) }),
			}),
		}),
		runtime: z.object({
			result: z.object({
				kind: z.literal("available"),
				value: z.object({
					checkpoint: z.object({
						id: z.string(),
						identity: z.string(),
						taskIds: z.array(z.string()),
					}),
					attempts: z.array(z.object({ id: z.string() })),
				}),
			}),
		}),
		processes: z.array(
			z.object({
				attemptId: z.string(),
				evidence: z.object({
					result: z.object({ kind: z.literal("available"), value: z.literal("stopped") }),
				}),
			}),
		),
	}),
);

/* eslint-enable unicorn/max-nested-calls */

/** Translate the existing public commands at one injected process boundary. */
export function workReviewCommands(process: NurseProcess, state: string): WorkReviewCommands {
	const execute = async (argv: string[], repository: RepositoryEndpoint) =>
		JSON.parse(await process.execute(argv, repository.root)) as unknown;
	const endpoint = (repository: RepositoryEndpoint) => [
		"--repo",
		repository.root,
		"--beads-db",
		repository.beadsDb,
	];
	return {
		attach: async ({ kind, runId, repository }) => {
			const output = await execute(
				[
					...entryCommand(colonyEntry("bee")),
					"attach-workflow",
					kind,
					runId,
					...endpoint(repository),
					"--actor",
					"sys-colony",
					"--json",
				],
				repository,
			);
			const result = submissionSchema.parse(output, { jitless: true });
			return { runId: result.workflow.runId, requestId: result.request.id };
		},
		assertTracker: async (repository) => {
			const output = await execute(
				["beeswax", "beads", "alert", "status", "--beads-db", repository.beadsDb, "--json"],
				repository,
			);
			const result = alertSchema.parse(output, { jitless: true });
			if (result.database !== repository.beadsDb || result.alert?.state === "active") {
				throw new WorkReviewError(
					"tracker_alert",
					"Selected tracker has an active or mismatched alert; automatic review paused",
				);
			}
		},
		start: async ({ kind, parent, input, repository }) => {
			const path = await process.writeInput(input.token, JSON.stringify(input));
			try {
				let workflow = "blocked-review";
				if (input.branch === "in_progress") {
					workflow = "in-progress-review";
				}
				const output = await execute(
					[
						...entryCommand(colonyEntry("bee")),
						"spawn",
						kind,
						...endpoint(repository),
						"--cwd",
						repository.root,
						"--actor",
						"sys-colony",
						"--parent",
						parent,
						"--workflow",
						workflow,
						"--input-file",
						path,
						"--json",
					],
					repository,
				);
				const result = submissionSchema.parse(output, { jitless: true });
				return { runId: result.workflow.runId, requestId: result.request.id };
			} catch (error) {
				const publication = publicationEffects(error);
				throw new WorkReviewPublicationError(String(error), publication, error);
			}
		},
		show: async (runId, repository) => {
			const output = await execute(
				["busybee", "show", runId, "--repo", repository.root, "--db", repository.beadsDb, "--json"],
				repository,
			);
			return showSchema.parse(output, { jitless: true });
		},
		continuation: async (input) => {
			const { request, repository } = input;
			const { assignment } = request;
			const cwd = request.recipe.cwd ?? repository.root;
			try {
				const output = JSON.parse(
					await process.execute(
						[
							"busybee",
							"system",
							"preview",
							assignment.runId,
							"--repo",
							cwd,
							"--db",
							repository.beadsDb,
							"--json",
						],
						cwd,
					),
				) as unknown;
				return admitSavedAssignment(inspectionSchema.parse(output, { jitless: true }), input);
			} catch (error) {
				let evidence = String(error);
				if (error instanceof CommandError) {
					evidence = error.stdout;
				}
				throw new WorkReviewError(
					"unsupported_continuation",
					`Cannot inspect saved ${assignment.kind} ${assignment.runId} in ${cwd}: ${evidence}; ` +
						"inspect the original checkpoint, definition and assignment before caller continuation",
				);
			}
		},
		stopped: async (request, repository) => {
			const requestId = request.id;
			const output = await execute(
				[
					...entryCommand(colonyEntry("colony")),
					"explain",
					requestId,
					...endpoint(repository),
					"--state",
					state,
					"--json",
				],
				repository,
			);
			const parsed = processSchema.safeParse(output, { jitless: true });
			if (!parsed.success) {
				return false;
			}
			const evidence = parsed.data;
			const { attempts, checkpoint } = evidence.runtime.result.value;
			const native = evidence.tracker.result.value;
			const taskIds = JSON.stringify(request.taskIds.toSorted());
			return (
				evidence.id === requestId &&
				evidence.repository.root === repository.root &&
				evidence.repository.beadsDb === repository.beadsDb &&
				native.identity === request.identity &&
				checkpoint.id === request.id &&
				checkpoint.identity === request.identity &&
				JSON.stringify(native.tasks.map(({ id }) => id).toSorted()) === taskIds &&
				JSON.stringify(checkpoint.taskIds.toSorted()) === taskIds &&
				attempts.length > NONE &&
				attempts.length === evidence.processes.length &&
				attempts.every((attempt) =>
					evidence.processes.some((fact) => fact.attemptId === attempt.id),
				)
			);
		},
		retry: async ({ requestId, resumeCancelled, repository, actor, cwd }) => {
			const continuationArgs: string[] = [];
			if (resumeCancelled) {
				continuationArgs.push("--resume-cancelled");
			}
			if (cwd !== null) {
				continuationArgs.push("--cwd", cwd);
			}
			try {
				const output = await execute(
					[
						...entryCommand(colonyEntry("bee")),
						"retry",
						requestId,
						...endpoint(repository),
						"--actor",
						actor,
						...continuationArgs,
						"--json",
					],
					repository,
				);
				const result = retrySchema.parse(output, { jitless: true });
				return { requestId: result.request.id };
			} catch (error) {
				throw new WorkReviewPublicationError(String(error), publicationEffects(error), error);
			}
		},
	};
}

// --- Private functions ---
function admitSavedAssignment(
	inspection: z.infer<typeof inspectionSchema>,
	{ request: { assignment }, lineageIds }: WorkReviewContinuation,
) {
	const active = inspection.actors.some(
		(actor) => actor.path.length === NONE && actor.snapshot.status === "active",
	);
	const stage =
		assignment.kind === "driver" ||
		inspection.actors.some((actor) =>
			Object.values(actor.instructions).some(
				(instruction) =>
					instruction.kind === "frozen" &&
					instruction.bead === assignment.stageId &&
					instruction.bee !== undefined &&
					lineageIds.includes(instruction.bee.request),
			),
		);
	if (inspection.runId !== assignment.runId || !active || !stage) {
		throw new Error("Saved active run/stage does not match the native predecessor assignment");
	}
	return {
		checkpoint: inspection.checkpoint,
		savedAt: inspection.savedAt,
		currentHash: inspection.definition.currentHash,
	};
}

function publicationEffects(error: unknown): {
	runId: string | null;
	requestId: string | null;
	replacementIds: string[];
} {
	/* eslint-disable unicorn/no-null -- Unknown effects remain explicitly uncertain and prevent resubmission. */
	const result: { runId: string | null; requestId: string | null; replacementIds: string[] } = {
		runId: null,
		requestId: null,
		replacementIds: [],
	};
	/* eslint-enable unicorn/no-null */
	if (error instanceof CommandError && error.stdout !== "") {
		const failure = failureEffectsSchema.parse(JSON.parse(error.stdout));
		result.runId = failure.runId ?? result.runId;
		result.requestId = failure.requestId ?? result.requestId;
		result.replacementIds = failure.replacementIds ?? [];
	}
	return result;
}
