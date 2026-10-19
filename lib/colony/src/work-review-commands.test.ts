/* eslint-disable unicorn/no-null -- Public JSON evidence distinguishes absent facts explicitly. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import type { NativeWorkflowState } from "@hive/shared";
import { WorkReviewError } from "./work-review.ts";
import { WorkReviewHealthError } from "./work-review-health.ts";
import { WorkReviewPublicationError } from "./work-review-runtime.ts";
import { readSpawnRequest } from "@hive/shared";
import { reportFailure } from "./cli.ts";
import { trackerScope } from "./tracker.ts";
import { workReviewCommands } from "./work-review-commands.ts";

const ONE = 1;
const NONE = 0;
const INSPECTION_PREFIX_SIZE = 5;
const repository = { root: "/repository", beadsDb: "/selected/tracker.db" };
const calls: string[][] = [];
let savedInput = "";
const commands = workReviewCommands(
	{
		writeInput: (_token, input) => {
			savedInput = input;
			return Promise.resolve("/input.json");
		},
		execute: (argv) => {
			calls.push(argv);
			return Promise.resolve(
				JSON.stringify({
					ok: true,
					request: { id: "replacement" },
					workflow: { runId: "saved-run" },
				}),
			);
		},
	},
	"/state",
);
const input = {
	branch: "blocked" as const,
	token: "scan",
	controlParent: "control",
	candidates: [{ taskId: "task", fingerprint: "semantic", requestId: null }],
};
const tracker = memoryTracker();
const savedRun = await createTask(tracker);
const predecessorId = await createSpawn(tracker, savedRun);
const predecessor = {
	...readSpawnRequest(
		await tracker.beads.show(trackerScope(tracker.repository, "worker"), predecessorId),
	),
	id: "predecessor",
	taskIds: ["saved-run"],
	assignment: { kind: "driver" as const, runId: "saved-run" },
};
test.each([
	{ branch: "blocked" as const, workflow: "blocked-review" },
	{ branch: "in_progress" as const, workflow: "in-progress-review" },
])(
	"ordinary $branch submission uses its named workflow and selected tracker",
	async ({ branch, workflow }) => {
		await commands.start({
			repository,
			kind: "drone",
			parent: "control",
			input: { ...input, branch },
		});
		expect(calls.at(-ONE)).toEqual(
			expect.arrayContaining([
				"spawn",
				"drone",
				"--workflow",
				workflow,
				"--beads-db",
				repository.beadsDb,
			]),
		);
		expect(JSON.parse(savedInput)).toMatchObject({ branch, token: "scan" });
	},
);
test("recovery invokes public bee retry for the exact predecessor with explicit cancellation only", async () => {
	await commands.retry({
		repository,
		actor: "reviewer",
		requestId: "predecessor",
		resumeCancelled: false,
		cwd: null,
	});
	expect(calls.at(-ONE)).toEqual(
		expect.arrayContaining(["retry", "predecessor", "--actor", "reviewer"]),
	);
	expect(calls.at(-ONE)).not.toContain("--resume-cancelled");
	await commands.retry({
		repository,
		actor: "reviewer",
		requestId: "paused",
		resumeCancelled: true,
		cwd: "/original-checkout",
	});
	expect(calls.at(-ONE)).toContain("--resume-cancelled");
	expect(calls.at(-ONE)).toContain("/original-checkout");
});

const stoppedEvidence = {
	ok: true,
	id: "predecessor",
	repository,
	tracker: {
		result: { kind: "available", value: { identity: "worker", tasks: [{ id: "saved-run" }] } },
	},
	runtime: {
		result: {
			kind: "available",
			value: {
				checkpoint: { id: "predecessor", identity: "worker", taskIds: ["saved-run"] },
				attempts: [{ id: "attempt" }],
			},
		},
	},
	diagnostics: [{ code: "failed", kind: "blocker" }],
	processes: [
		{ attemptId: "attempt", evidence: { result: { kind: "available", value: "stopped" } } },
	],
};
const savedDiagram = {
	formatVersion: ONE,
	runId: "saved-run",
	title: "Original run",
	checkpoint: "saved-checkpoint",
	savedAt: "revision",
	definition: {
		label: "work",
		savedHash: "original",
		currentHash: "compatible",
		sourceMatch: "compatible",
	},
	actors: [
		{
			id: "root",
			path: [],
			machine: {},
			snapshot: { value: "working", status: "active" },
			instructions: {
				working: {
					kind: "frozen",
					title: "Original stage",
					instructions: "Work",
					bead: "saved-stage",
					bee: { kind: "worker", request: "original-publication" },
				},
			},
		},
	],
};
const savedInspection = {
	ok: true,
	kind: "workflow_lifecycle",
	runId: "saved-run",
	nativeStatus: "in_progress",
	updatedAt: "native-revision",
	publication: {
		checkpoint: "saved-checkpoint",
		savedAt: "revision",
		locked: false,
		settlement: "none",
	},
	lifecycle: { kind: "pending" },
	resolution: { kind: "unresolved" },
	diagram: { kind: "available", mode: "instructions", data: savedDiagram },
};
test.each([
	{ kind: "driver" as const, stageId: "unused", requestIds: ["predecessor"], expected: true },
	{
		kind: "stage" as const,
		stageId: "saved-stage",
		requestIds: ["predecessor", "original-publication"],
		expected: true,
	},
	{
		kind: "stage" as const,
		stageId: "different-stage",
		requestIds: ["original-publication"],
		expected: false,
	},
	{ kind: "stage" as const, stageId: "saved-stage", requestIds: ["unrelated"], expected: false },
])(
	"public saved $kind inspection binds the original assignment ($stageId, $expected)",
	async ({ kind, stageId, requestIds, expected }) => {
		const observed = { argv: [] as string[], cwd: "" };
		const boundary = workReviewCommands(
			{
				writeInput: () => {
					throw new Error("Inspection must not write");
				},
				execute: (argv, cwd) => {
					observed.argv = argv;
					observed.cwd = cwd;
					return Promise.resolve(JSON.stringify(savedInspection));
				},
			},
			"/state",
		);
		const request = {
			...predecessor,
			assignment: { kind, runId: "saved-run", stageId },
			recipe: { ...predecessor.recipe, cwd: "/original-checkout" },
		};
		const result = await boundary
			.continuation({ request, lineageIds: requestIds, repository })
			.catch((error: unknown) => error);
		if (expected) {
			expect(result).toEqual({
				checkpoint: "saved-checkpoint",
				savedAt: "revision",
				currentHash: "compatible",
			});
		} else {
			expect(result).toBeInstanceOf(WorkReviewError);
		}
		expect(observed).toEqual({
			argv: [
				"busybee",
				"inspect",
				"saved-run",
				"--diagram",
				"--instructions",
				"--repo",
				"/original-checkout",
				"--db",
				repository.beadsDb,
				"--json",
			],
			cwd: "/original-checkout",
		});
	},
);

test.each([
	{
		name: "unavailable requested diagram",
		inspection: {
			...savedInspection,
			diagram: {
				kind: "unavailable",
				reason: "definition_changed",
				message: "Incompatible definition",
				context: { requiredVersion: "^1.0.0", proposedVersion: "2.0.0" },
			},
		},
	},
	{
		name: "retired native run with active saved actors",
		inspection: {
			...savedInspection,
			nativeStatus: "closed",
			lifecycle: {
				kind: "terminal",
				closedAt: "sampled",
				fact: {
					kind: "busybee-lifecycle",
					formatVersion: ONE,
					scope: "run",
					runId: "saved-run",
					outcome: "failed",
					reason: "Retired fixture",
				},
			},
		},
	},
	{
		name: "unclassified native closure",
		inspection: {
			...savedInspection,
			nativeStatus: "closed",
			lifecycle: { kind: "unavailable", reason: "unclassified_closure" },
		},
	},
	{
		name: "publication lock",
		inspection: {
			...savedInspection,
			publication: { ...savedInspection.publication, locked: true },
		},
	},
	{
		name: "unfinished settlement",
		inspection: {
			...savedInspection,
			publication: { ...savedInspection.publication, settlement: "pending" },
		},
	},
	{
		name: "different outer checkpoint",
		inspection: {
			...savedInspection,
			publication: { ...savedInspection.publication, checkpoint: "another-checkpoint" },
		},
	},
	{
		name: "different outer revision",
		inspection: {
			...savedInspection,
			publication: { ...savedInspection.publication, savedAt: "another-revision" },
		},
	},
	{
		name: "different saved run",
		inspection: {
			...savedInspection,
			diagram: {
				...savedInspection.diagram,
				data: { ...savedDiagram, runId: "another-run" },
			},
		},
	},
	{
		name: "different native run",
		inspection: { ...savedInspection, runId: "another-run" },
	},
	{
		name: "structure-only diagram",
		inspection: {
			...savedInspection,
			diagram: { kind: "available", mode: "structure", data: savedDiagram },
		},
	},
	{
		name: "completed saved actor",
		inspection: {
			...savedInspection,
			diagram: {
				...savedInspection.diagram,
				data: {
					...savedDiagram,
					actors: [
						{
							...savedDiagram.actors[NONE],
							snapshot: { value: "working", status: "done" },
						},
					],
				},
			},
		},
	},
])("public continuation refuses $name without recovery effects", async ({ inspection }) => {
	const inspectionCalls: string[][] = [];
	const boundary = workReviewCommands(
		{
			writeInput: () => {
				throw new Error("Inspection must not write");
			},
			execute: (argv) => {
				inspectionCalls.push(argv);
				return Promise.resolve(JSON.stringify(inspection));
			},
		},
		"/state",
	);
	const failure = await boundary
		.continuation({ request: predecessor, lineageIds: [predecessor.id], repository })
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ reason: "unsupported_continuation" });
	if ("context" in inspection.diagram) {
		expect((failure as WorkReviewError).message).toContain("definition_changed");
		expect((failure as WorkReviewError).message).toContain("^1.0.0");
		expect((failure as WorkReviewError).message).toContain("2.0.0");
	}
	expect(inspectionCalls).toHaveLength(ONE);
	expect(inspectionCalls.at(-ONE)?.slice(NONE, INSPECTION_PREFIX_SIZE)).toEqual([
		"busybee",
		"inspect",
		"saved-run",
		"--diagram",
		"--instructions",
	]);
});

test("work-review completion consumes native facts without requesting a diagram", async () => {
	const lifecycle: NativeWorkflowState = {
		kind: "terminal",
		closedAt: "sampled",
		fact: {
			kind: "busybee-lifecycle",
			formatVersion: ONE,
			scope: "run",
			runId: "saved-run",
			outcome: "succeeded",
			reason: "Fixture completion",
		},
	};
	const observed = { argv: [] as string[], cwd: "" };
	const boundary = workReviewCommands(
		{
			writeInput: () => {
				throw new Error("Inspection must not write");
			},
			execute: (argv, cwd) => {
				observed.argv = argv;
				observed.cwd = cwd;
				return Promise.resolve(
					JSON.stringify({
						ok: true,
						kind: "workflow_lifecycle",
						runId: "saved-run",
						nativeStatus: "closed",
						updatedAt: "native-revision",
						publication: savedInspection.publication,
						lifecycle,
						resolution: { kind: "resolved" },
					}),
				);
			},
		},
		"/state",
	);
	expect(await boundary.inspect("saved-run", repository)).toEqual(lifecycle);
	expect(observed).toEqual({
		argv: [
			"busybee",
			"--repo",
			repository.root,
			"--db",
			repository.beadsDb,
			"--actor",
			"sys-colony",
			"--json",
			"inspect",
			"saved-run",
		],
		cwd: repository.root,
	});
});

test.each(["missing_checkpoint", "incompatible_definition"])(
	"public %s inspection failure preserves evidence and refuses continuation",
	async (reason) => {
		const boundary = workReviewCommands(
			{
				writeInput: () => {
					throw new Error("Inspection must not write");
				},
				execute: () =>
					Promise.reject(
						new CommandError("busybee", {
							code: ONE,
							stderr: "",
							stdout: JSON.stringify({ ok: false, reason }),
						}),
					),
			},
			"/state",
		);
		const failure = await boundary
			.continuation({ request: predecessor, lineageIds: [predecessor.id], repository })
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(WorkReviewError);
		expect((failure as WorkReviewError).message).toContain(reason);
	},
);
test.each([
	{ name: "fresh stopped execution", evidence: stoppedEvidence, expected: true },
	{
		name: "changed native identity",
		evidence: {
			...stoppedEvidence,
			tracker: {
				result: { kind: "available", value: { identity: "other", tasks: [{ id: "saved-run" }] } },
			},
		},
		expected: false,
	},
	{
		name: "changed captured task",
		evidence: {
			...stoppedEvidence,
			runtime: {
				result: {
					kind: "available",
					value: {
						checkpoint: { id: "predecessor", identity: "worker", taskIds: ["other-task"] },
						attempts: [{ id: "attempt" }],
					},
				},
			},
		},
		expected: false,
	},
	{
		name: "changed native task",
		evidence: {
			...stoppedEvidence,
			tracker: {
				result: { kind: "available", value: { identity: "worker", tasks: [{ id: "other-task" }] } },
			},
		},
		expected: false,
	},
	{
		name: "changed captured identity",
		evidence: {
			...stoppedEvidence,
			runtime: {
				result: {
					kind: "available",
					value: {
						checkpoint: { id: "predecessor", identity: "other", taskIds: ["saved-run"] },
						attempts: [{ id: "attempt" }],
					},
				},
			},
		},
		expected: false,
	},
	{
		name: "empty retained attempts",
		evidence: {
			...stoppedEvidence,
			runtime: { result: { kind: "available", value: { attempts: [] } } },
			processes: [],
		},
		expected: false,
	},
	{
		name: "live execution",
		evidence: {
			...stoppedEvidence,
			processes: [
				{ attemptId: "attempt", evidence: { result: { kind: "available", value: "live" } } },
			],
		},
		expected: false,
	},
	{
		name: "foreign endpoint",
		evidence: { ...stoppedEvidence, repository: { ...repository, beadsDb: "/other.db" } },
		expected: false,
	},
])("current process evidence: $name", async ({ evidence, expected }) => {
	const boundary = workReviewCommands(
		{
			writeInput: () => Promise.resolve("unused"),
			execute: () => Promise.resolve(JSON.stringify(evidence)),
		},
		"/state",
	);
	expect(await boundary.stopped(predecessor, repository)).toBe(expected);
});

const interrupted = workReviewCommands(
	{
		writeInput: () => Promise.resolve("/input.json"),
		execute: () =>
			Promise.reject(
				new CommandError("bee", {
					code: 1,
					stderr: "",
					stdout: JSON.stringify({
						ok: false,
						reason: "request_labels_pending",
						runId: "created-run",
						requestId: "created-request",
					}),
				}),
			),
	},
	"/state",
);
test("failed submission retains confirmed IDs for inspection", async () => {
	try {
		await interrupted.start({ repository, kind: "drone", parent: "control", input });
		throw new Error("Expected publication refusal");
	} catch (error) {
		expect(error).toBeInstanceOf(WorkReviewPublicationError);
		expect((error as WorkReviewPublicationError).publication).toEqual({
			runId: "created-run",
			requestId: "created-request",
		});
	}
});

test("tracker alerts stop public review operations", async () => {
	const boundary = workReviewCommands(
		{
			writeInput: () => Promise.resolve("unused"),
			execute: () =>
				Promise.resolve(
					JSON.stringify({ ok: true, database: repository.beadsDb, alert: { state: "active" } }),
				),
		},
		"/state",
	);
	await expect(boundary.assertTracker(repository)).rejects.toBeInstanceOf(WorkReviewError);
});

const pausedRecovery = new WorkReviewHealthError(
	{
		requestId: "predecessor",
		taskId: "task",
		phase: "unblocked",
		reopenedIds: ["saved-run"],
		replacementIds: ["known-replacement"],
	},
	new Error("Tracker health could not be read"),
);
test("public JSON failure retains recovery effects and follow-up with silent stderr", () => {
	const streams = { stdout: "", stderr: "" };
	const code = reportFailure(pausedRecovery, true, {
		command: "colony",
		stdout: (text) => {
			streams.stdout += text;
		},
		stderr: (text) => {
			streams.stderr += text;
		},
	});
	const failure = JSON.parse(streams.stdout);
	expect(code).toBe(ONE);
	expect(streams.stderr).toBe("");
	expect(failure.reason).toBe("tracker_unavailable");
	expect(failure.reopenedIds).toEqual(["saved-run"]);
	expect(failure.replacementIds).toEqual(["known-replacement"]);
	expect(failure.phase).toBe("unblocked");
	expect(failure.nextAction).toBe(pausedRecovery.nextAction);
});

const failedRetryPublication = new CommandError("bee", {
	code: ONE,
	stderr: "",
	stdout: JSON.stringify({
		ok: false,
		reason: "request_labels_pending",
		requestId: "predecessor",
		replacementIds: ["created-replacement"],
	}),
});
const retryBoundary = workReviewCommands(
	{
		writeInput: () => {
			throw new Error("Retry requires no new workflow input");
		},
		execute: () => Promise.reject(failedRetryPublication),
	},
	"/state",
);
test("retry publication failure exposes confirmed replacement IDs before further native inspection", async () => {
	const failure = await retryBoundary
		.retry({
			requestId: "predecessor",
			resumeCancelled: false,
			repository,
			actor: "reviewer",
			cwd: null,
		})
		.catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(WorkReviewPublicationError);
	expect((failure as WorkReviewPublicationError).replacementIds).toEqual(["created-replacement"]);
});
