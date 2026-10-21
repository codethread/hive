import {
	WorkflowSubmissionError,
	attachWorkflow,
	dispatchStage,
	submitWorkflow,
} from "./workflow-submission.ts";
import { beesConfigSchema, readSpawnRequest } from "@hive/shared";
import { createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { BeadsScope } from "@hive/beads";
import type { WorkflowSubmissionCommands } from "./workflow-submission.ts";
import { reportFailure } from "./cli.ts";
import { trackerScope } from "./tracker.ts";
import { validateRequestedTasks } from "./producer.ts";

const ONE = 1;
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

async function fixture() {
	const tracker = memoryTracker();
	const parent = await createTask(tracker, { title: "Original task", assignee: "ct" });
	const submission = { ...options, parent };
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
				runId = await createTask(tracker, { title: "Author workflow", parent: input.parent });
				const stage = await createTask(tracker, { title: "Actual assignment", parent: runId });
				const checkpoint = await createTask(tracker, {
					labels: ["system", "busybee-checkpoint"],
					description: JSON.stringify({ formatVersion: 1, id: runId, managedExecution: "managed" }),
				});
				await tracker.beads.dep.add(
					trackerScope(tracker.repository, "fixture"),
					runId,
					checkpoint,
					"related",
				);
				// Unpublished Bee dispatch request identity is explicitly absent in Busybee output.
				// eslint-disable-next-line unicorn/no-null
				return { id: runId, status: "active", active: [{ bead: stage, request: null }] };
			},
			show: (id) => Promise.resolve({ id, status: "active", active: [] }),
			prepareDriver: (id) => {
				handoffs += ONE;
				return Promise.resolve({ runId: id, status: "active", checkpoint: "checkpoint-1" });
			},
		},
	};
	return {
		commands,
		selected,
		tracker,
		parent,
		submission,
		handoffs: () => handoffs,
		runId: () => runId,
	};
}

// Warm request/config boundary schemas outside the measured tests.
const warmed = await fixture();
const warmedResult = await submitWorkflow("worker", warmed.submission, warmed.commands);
readSpawnRequest(
	await warmed.tracker.beads.show(
		trackerScope(warmed.tracker.repository, "inspect"),
		warmedResult.request.id,
	),
);

test.each([
	{ selector: { workflow: "land" }, selection: { kind: "named", name: "land" } },
	{
		selector: { source: "custom/workflow.ts" },
		selection: { kind: "source", path: "/caller/custom/workflow.ts" },
	},
])(
	"caller selector $selector is resolved before subprocess execution #test-474",
	async ({ selector, selection }) => {
		const { commands, selected, submission, parent } = await fixture();
		const result = await submitWorkflow("worker", { ...submission, ...selector }, commands);
		expect(selected).toMatchObject([{ selection, parent, inputFile: "/caller/work.json" }]);
		expect(result.workflow.parentId).toBe(parent);
	},
);

// Confirm absence of publication, then attach without recreating the ordinary hierarchy.

test(
	"confirmed orphan attachment retains its native parent and unfinished " +
		"driver-handled visit #test-364",
	// eslint-disable-next-line max-statements
	async () => {
		const { commands, tracker, selected, handoffs, submission, parent } = await fixture();
		const run = await commands.workflows.start({
			parent,
			endpoint: { actor: options.actor, repo: options.repo, db: options.beadsDb },
			owner: "ct",
			selection: { kind: "named", name: "do-work" },
			inputFile: submission.inputFile,
		});
		const ids = [parent, run.id, ...run.active.map((entry) => entry.bead)];
		const scope = trackerScope(tracker.repository, "inspect");
		const before = await tracker.beads.showMany(scope, ids);
		const result = await attachWorkflow({ kind: "worker", runId: run.id, options }, commands);
		expect(result.workflow.runId).toBe(run.id);
		expect(selected).toHaveLength(ONE);
		expect(handoffs()).toBe(ONE);
		const retained = await tracker.beads.showMany(scope, ids);
		const runRecord = retained.find((record) => record.id === run.id)!;
		expect(
			retained.map(({ dependencies: _dependencies, dependents: _dependents, ...record }) => record),
		).toEqual(
			before.map(({ dependencies: _dependencies, dependents: _dependents, ...record }) => record),
		);
		expect(runRecord.dependencies).toContainEqual(
			expect.objectContaining({ id: parent, dependency_type: "parent-child" }),
		);
		expect(readSpawnRequest(await tracker.beads.show(scope, result.request.id))).toMatchObject({
			assignment: { kind: "driver", runId: run.id },
			taskIds: [run.id],
		});
	},
);

test("driver publication failure reports the existing run and uncertain request creation", async () => {
	const current = await fixture();
	const beads = {
		...current.commands.beads,
		create: () => Promise.reject(new Error("create interrupted")),
	};
	const commands = { ...current.commands, beads };
	const failureResult: unknown = await submitWorkflow("worker", current.submission, commands).catch(
		(error: unknown) => error,
	);
	expect(failureResult).toBeInstanceOf(WorkflowSubmissionError);
	expect(failureResult).toMatchObject({
		reason: "workflow_driver_failed",
		context: {
			parentId: current.parent,
			runId: current.runId(),
			checkpoint: "checkpoint-1",
			driverPublication: "uncertain",
			stageRequestIds: [],
			stageIds: [expect.any(String)],
			nextAction: `br show ${current.runId()} --json`,
		},
	});
});

const dispatched = await fixture();
const dispatchedRun = await createTask(dispatched.tracker, { parent: dispatched.parent });
const checkpoint = await createTask(dispatched.tracker, {
	labels: ["system", "busybee-checkpoint"],
	description: JSON.stringify({ formatVersion: 1, id: dispatchedRun, managedExecution: "managed" }),
});
await dispatched.tracker.beads.dep.add(
	trackerScope(dispatched.tracker.repository, "fixture"),
	dispatchedRun,
	checkpoint,
	"related",
);
const group = await createTask(dispatched.tracker, { parent: dispatchedRun });
const stage = await createTask(dispatched.tracker, { parent: group });

test("stage dispatch uses native ancestry during initial frontier publication #test-562", async () => {
	const beads = {
		...dispatched.commands.beads,
		show: (scope: BeadsScope, id: string) => {
			if (id === dispatched.parent) {
				throw new Error("External parent is outside stage admission");
			}
			return dispatched.commands.beads.show(scope, id);
		},
	};
	const workflows = {
		...dispatched.commands.workflows,
		show: () => {
			throw new Error("checkpoint is not yet published");
		},
	};
	const result = await dispatchStage(
		{ kind: "worker", stageId: stage, options: { ...options, run: dispatchedRun } },
		{ ...dispatched.commands, beads, workflows },
	);
	const request = readSpawnRequest(
		await dispatched.tracker.beads.show(
			trackerScope(dispatched.tracker.repository, "inspect"),
			result.request.id,
		),
	);
	expect(request.assignment).toEqual({ kind: "stage", runId: dispatchedRun, stageId: stage });
	expect(request.taskIds).toEqual([stage]);
});

test("unknown kind preserves the CLI failure envelope and creates no workflow #test-383", async () => {
	const { commands, selected, submission } = await fixture();
	const failure: unknown = await submitWorkflow("missing", submission, commands).catch(
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
