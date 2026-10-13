import {
	WorkflowSubmissionError,
	attachWorkflow,
	dispatchStage,
	submitWorkflow,
} from "./workflow-submission.ts";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { WorkflowSubmissionCommands } from "./workflow-submission.ts";
import { reportFailure } from "./cli.ts";
import { trackerScope } from "./tracker.ts";
import { validateRequestedTasks } from "./producer.ts";

const ONE = 1;
const RUN_AND_REQUEST = 2;
const config = beesConfigSchema.parse({
	owner: "ct",
	humans: ["ct"],
	kinds: {
		worker: { description: "Do work", harness: "fixture", model: "fixture", effort: "low" },
	},
	formulas: { fixture: { executable: "fixture", argv: ["{{prompt}}"] } },
});
const options = {
	actor: "requester",
	beadsDb: "/fixture/tracker.db",
	repo: "/fixture",
	inputFile: "work.json",
};

function fixture() {
	const tracker = memoryTracker();
	const selected: unknown[] = [];
	let runId = "";
	let handoffs = 0;
	const commands: WorkflowSubmissionCommands = {
		...tracker,
		cwd: "/caller",
		executionDirectory: (directory) => Promise.resolve(directory),
		loadBeesConfig: () => Promise.resolve({ config, warnings: [] }),
		admit: async (id, admission) => {
			await validateRequestedTasks({ requestedIds: [id], options: admission }, commands);
		},
		workflows: {
			start: async (input) => {
				selected.push(input);
				runId = await createTask(tracker, { title: "Caller assignment" });
				return { id: runId, status: "active", active: [] };
			},
			show: (id) => Promise.resolve({ id, status: "active", active: [] }),
			prepareDriver: (id) => {
				handoffs += ONE;
				return Promise.resolve({ runId: id, status: "active", checkpoint: "checkpoint-1" });
			},
		},
	};
	return { commands, selected, tracker, handoffs: () => handoffs, runId: () => runId };
}

// Warm request/config boundary schemas outside the measured tests.
await submitWorkflow("worker", options, fixture().commands);

test("default workflow submission captures one driver and the actual run anchor", async () => {
	const { commands, selected, tracker } = fixture();
	const result = await submitWorkflow("worker", options, commands);
	expect(selected).toEqual([
		{
			endpoint: { actor: "requester", db: "/fixture/tracker.db", repo: "/fixture" },
			owner: "ct",
			inputFile: "/caller/work.json",
			selection: { kind: "named", name: "do-work" },
		},
	]);
	const request = readSpawnRequest(
		await tracker.beads.show(trackerScope(tracker.repository, "inspect"), result.request.id),
	);
	expect(request.assignment).toEqual({ kind: "driver", runId: result.workflow.runId });
	expect(request.taskIds).toEqual([result.workflow.runId]);
});

test.each([
	{ selector: { workflow: "land" }, selection: { kind: "named", name: "land" } },
	{
		selector: { source: "custom/workflow.ts" },
		selection: { kind: "source", path: "/caller/custom/workflow.ts" },
	},
])(
	"caller selector $selector is resolved before subprocess execution",
	async ({ selector, selection }) => {
		const { commands, selected } = fixture();
		await submitWorkflow("worker", { ...options, ...selector }, commands);
		expect(selected).toMatchObject([{ selection }]);
	},
);

test("same-run attachment rejects duplicate drivers before mutating the handoff", async () => {
	const { commands, handoffs, tracker } = fixture();
	const result = await submitWorkflow("worker", options, commands);
	await expect(
		attachWorkflow({ kind: "worker", runId: result.workflow.runId, options }, commands),
	).rejects.toBeInstanceOf(Error);
	expect(handoffs()).toBe(ONE);
	const issues = await tracker.beads.list(trackerScope(tracker.repository, "inspect"), {
		limit: 0,
	});
	expect(issues.issues).toHaveLength(RUN_AND_REQUEST);
});

test("driver publication failure reports the existing run and uncertain request creation", async () => {
	const current = fixture();
	const beads = {
		...current.commands.beads,
		create: () => Promise.reject(new Error("create interrupted")),
	};
	const commands = { ...current.commands, beads };
	const failureResult: unknown = await submitWorkflow("worker", options, commands).catch(
		(error: unknown) => error,
	);
	expect(failureResult).toBeInstanceOf(WorkflowSubmissionError);
	expect(failureResult).toMatchObject({
		reason: "workflow_driver_failed",
		context: {
			runId: current.runId(),
			checkpoint: "checkpoint-1",
			driverPublication: "uncertain",
			stageRequestIds: [],
		},
	});
});

const automatic = fixture();
const automaticRun = await createTask(automatic.tracker);
const group = await createTask(automatic.tracker, { parent: automaticRun });
const stage = await createTask(automatic.tracker, { parent: group });

test("stage dispatch uses native ancestry during initial frontier publication", async () => {
	const workflows = {
		...automatic.commands.workflows,
		show: () => {
			throw new Error("checkpoint is not yet published");
		},
	};
	const result = await dispatchStage(
		{ kind: "worker", stageId: stage, options: { ...options, run: automaticRun } },
		{ ...automatic.commands, workflows },
	);
	const request = readSpawnRequest(
		await automatic.tracker.beads.show(
			trackerScope(automatic.tracker.repository, "inspect"),
			result.request.id,
		),
	);
	expect(request.assignment).toEqual({ kind: "stage", runId: automaticRun, stageId: stage });
	expect(request.taskIds).toEqual([stage]);
});

test("unknown kind preserves the CLI failure envelope and creates no workflow", async () => {
	const { commands, selected } = fixture();
	const failure: unknown = await submitWorkflow("missing", options, commands).catch(
		(error: unknown) => error,
	);
	const stdout: string[] = [];
	const stderr: string[] = [];
	reportFailure(failure, true, {
		command: "bee",
		stdout: (value) => stdout.push(value),
		stderr: (value) => stderr.push(value),
	});
	expect(JSON.parse(stdout.join(""))).toEqual({
		ok: false,
		kind: "error",
		reason: "unknown_kind",
		beeKind: "missing",
		message: "Unknown bee kind missing.",
	});
	expect(stderr).toEqual([]);
	expect(selected).toEqual([]);
});
