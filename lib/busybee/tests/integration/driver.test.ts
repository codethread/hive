/* eslint-disable import/max-dependencies -- Driver contracts also exercise the bundled author definition. */
import { BusyBeeError, createServices } from "../../src/native.ts";
import { assign, createMachine } from "xstate";
import { describe, expect, test } from "bun:test";
import {
	runBrief as doWorkBrief,
	commandSchemas as doWorkCommands,
	machine as doWorkMachine,
	inputSchema as doWorkSchema,
} from "../../../../.workflows/do-work/workflow.ts";
import { navigate, prepareDriver, recordResult, start } from "../../src/runtime.ts";
import { renderResponseInstructions, spawnRequestLabels } from "@hive/shared";
import type { Definition } from "../../src/definition.ts";
import type { Services } from "../../src/native.ts";
import { createMemoryBeads } from "@hive/beads";
import { invoke } from "./support.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const FAILURE = 1;
const INITIAL_RECORDS = 4;
const DISPATCH_PREFIX = 6;
const RECIPE_RUN_ARG = 5;
const RECIPE_STAGE_ARG = 3;
const LOCK_TIMEOUT = 10_000;
const recipe = {
	cwd: "/driver-repo",
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Stage work",
	system_prompt: "Worker",
};
const repo = "/driver-repo";
const db = "/driver-tracker/beads.db";
const scope = { actor: "caller", cwd: repo, db };
const meta = {
	title: "Work",
	commands: { selected: "SELECTED" },
	task: () => ({ instructions: "Perform work" }),
};
const resultShape = z.object({
	answer: z.array(z.string()),
	nested: z.object({ revision: z.number() }),
});
const payloadSchema = z.compile(resultShape);
const payload = { answer: ["arbitrary", "result"], nested: { revision: 7 } };
const definition = {
	inputSchema: z.object({}),
	commandSchemas: { selected: payloadSchema },
	runBrief: () => ({ title: "Driver run", description: "Assignment" }),
	machine: createMachine({
		id: "driver-test",
		context: { saved: {} },
		initial: "work",
		states: {
			work: {
				meta,
				on: {
					SELECTED: { target: "followup", actions: assign({ saved: ({ event }) => event.data }) },
				},
			},
			followup: { meta, on: { SELECTED: "done" } },
			done: { type: "final" },
		},
	}),
};

const transformedDefinition: Definition = {
	...definition,
	commandSchemas: {
		selected: z.compile(
			z.strictObject({ choice: z.string(), value: z.string().transform(Number) }),
		),
	},
};

const beeDefinition = {
	...definition,
	commandSchemas: { selected: payloadSchema },
	machine: createMachine({
		id: "bee-dispatch-test",
		initial: "work",
		states: {
			work: { meta: { ...meta, bee: { kind: "worker" } }, on: { SELECTED: "done" } },
			done: { type: "final" },
		},
	}),
};

async function fixture(selected: unknown = definition, input: unknown = {}) {
	const beads = createMemoryBeads({ db });
	const io: Services = {
		...createServices(),
		actor: "caller",
		beads,
		cwd: repo,
		importModule: () => Promise.resolve(selected),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		readText: () => Promise.resolve(JSON.stringify(input)),
		execute: () => Promise.reject(new Error("Unexpected process execution")),
	};
	const parent = await beads.create(scope, { title: "Original work", owner: "ct" });
	const run = await start(
		"workflow.ts",
		{ owner: "ct", assignee: "", parent: parent.id, inputFile: "input.json" },
		io,
	);
	const root = await beads.show(scope, run.id);
	const checkpoint = root.dependencies.find((edge) => edge.dependency_type === "related")!.id;
	return { beads, checkpoint, io, run };
}

const doWorkInput = {
	title: "Implement assigned scope",
	request: "Complete the actual caller assignment",
	acceptance: ["Verify the requested change"],
};
const defaultRun = await fixture(
	{
		commandSchemas: doWorkCommands,
		inputSchema: doWorkSchema,
		machine: doWorkMachine,
		runBrief: doWorkBrief,
	},
	doWorkInput,
);

test("default author distinguishes the run while preserving the actual stage assignment", async () => {
	const root = await defaultRun.beads.show(scope, defaultRun.run.id);
	expect(root).toMatchObject({
		title: "Do work: Implement assigned scope",
		description: doWorkInput.request,
	});
	expect(defaultRun.run.active).toMatchObject([
		{
			title: doWorkInput.title,
			context: doWorkInput,
			instructions: expect.stringContaining(doWorkInput.request),
		},
	]);
	const stage = await defaultRun.beads.show(scope, defaultRun.run.active[FIRST]!.bead);
	expect(stage.dependencies).toMatchObject([{ id: root.id, dependency_type: "parent-child" }]);
	expect(stage.description).toContain(renderResponseInstructions({ taskId: root.id }));
});

// Compile the injected chart/checkpoint schemas and CLI boundary once before measured cases.
const warmup = await fixture();
await invoke(["prepare-driver", warmup.run.id], warmup.io);
await recordResult(
	{ id: warmup.run.id, bead: warmup.run.active[FIRST]!.bead, choice: "selected", data: payload },
	{},
	warmup.io,
);
await warmup.beads.close(scope, warmup.run.active[FIRST]!.bead);
await navigate({ id: warmup.run.id, operation: "collect" }, {}, warmup.io);
const beeWarmup = await beeFixture();
await beeWarmup.beads.close(scope, beeWarmup.stage.request!, { reason: "blocked" });
await invoke(["collect", beeWarmup.run.id], beeWarmup.io);
await recordResult(
	{
		id: beeWarmup.run.id,
		bead: beeWarmup.stage.bead,
		choice: "selected",
		data: payload,
	},
	{},
	beeWarmup.io,
);
await beeWarmup.beads.close(scope, beeWarmup.stage.bead);
await navigate({ id: beeWarmup.run.id, operation: "collect" }, {}, beeWarmup.io);
await invoke(["init"], {
	...warmup.io,
	execute: () => Promise.resolve(repo),
	installWorkflow: () => Promise.resolve(),
});

const reservationCases = [
	{ target: "run", assignee: "ct", owner: "ct", labels: [] },
	{ target: "run", assignee: "caller", owner: "ct", labels: ["hitl"] },
	{ target: "stage", assignee: "ct", owner: "ct", labels: [] },
	{ target: "stage", assignee: "caller", owner: "ct", labels: ["hitl"] },
	{ target: "run", assignee: "operator", owner: "operator", labels: [] },
	{ target: "stage", assignee: "operator", owner: "operator", labels: [] },
];
const invalidNotes = [
	"",
	"bad json",
	'{"choice":"selected"}',
	'{"choice":"selected","data":{"answer":7}}',
];
const reservedRuns = new Map(
	await Promise.all(
		reservationCases.map(async (entry) => [JSON.stringify(entry), await fixture()] as const),
	),
);
const invalidRuns = new Map(
	await Promise.all(invalidNotes.map(async (notes) => [notes, await fixture()] as const)),
);
const handoff = await fixture();
const closedRun = await fixture();
const lockedRun = await fixture();
const failedWrite = await fixture();
const resumed = await fixture();
const assignedRun = await fixture();
const transformed = await fixture(transformedDefinition);
const conflicting = await fixture();
const invalidInput = await fixture();
const arrayPayloadSchema = z.compile(z.array(z.string()));
const arrayRun = await fixture({
	...definition,
	commandSchemas: { selected: arrayPayloadSchema },
});
const resumedResponse = await filedResponse(resumed, resumed.run.id);
await filedResponse(invalidInput, invalidInput.run.id);
await filedResponse(transformed, transformed.run.id);
const doneRun = await fixture({
	...definition,
	machine: createMachine({
		context: { saved: {} },
		initial: "done",
		states: { done: { type: "final" } },
	}),
});

// Register coherent handoff and durable result scenarios against independently prepared runs.
// eslint-disable-next-line max-statements
describe("driver coordination", () => {
	// Verify the whole handoff through its public CLI envelope and native reservations.
	// eslint-disable-next-line max-statements
	test("driver handoff opens only the run and preserves driver-handled stage reservation", async () => {
		const { beads, checkpoint, io, run } = handoff;
		await beads.update(scope, [run.active[FIRST]!.bead], { assignee: "caller" });
		const result = await prepareDriver(run.id, {}, io);
		expect(result).toEqual({
			checkpoint,
			runId: run.id,
			status: "active",
		});
		const root = await beads.show(scope, run.id);
		expect(root).toMatchObject({ status: "open", owner: "ct" });
		expect(root.assignee).toBeUndefined();
		expect(await beads.show(scope, run.active[FIRST]!.bead)).toMatchObject({
			assignee: "caller",
			status: "in_progress",
		});
		expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
		const { issues } = await beads.list(scope, { all: true, limit: FIRST });
		expect(issues).toHaveLength(INITIAL_RECORDS);
	});

	test.each(reservationCases)(
		"handoff rejects human reservation on $target ($assignee, $labels)",
		// Compare the reserved native root before and after the rejected handoff.
		// eslint-disable-next-line max-statements
		async ({ target, assignee, owner, labels }) => {
			const { beads, checkpoint, io, run } = reservedRuns.get(
				JSON.stringify({ target, assignee, owner, labels }),
			)!;
			let bead = run.id;
			if (target === "stage") {
				({ bead } = run.active[FIRST]!);
			}
			await beads.update(scope, [bead], { assignee, owner, labels });
			const before = await beads.show(scope, run.id);
			const result = await invoke(["prepare-driver", run.id], io);
			expect(result.code).toBe(FAILURE);
			expect(result.document).toMatchObject({
				ok: false,
				kind: "prepare-driver",
				reason: "human_reserved",
				bead,
			});
			expect(await beads.show(scope, run.id)).toEqual(before);
			expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
		},
	);

	test("initially completed run stays closed and requires no driver", async () => {
		const { beads, checkpoint, io, run } = doneRun;
		const before = await beads.show(scope, run.id);
		const result = await invoke(["prepare-driver", run.id], io);
		expect(result.document).toEqual({
			ok: true,
			kind: "prepare-driver",
			runId: run.id,
			status: "done",
			checkpoint,
		});
		expect(await beads.show(scope, run.id)).toEqual(before);
		expect(before.status).toBe("closed");
	});

	test("handoff refuses a natively closed active run", async () => {
		const { beads, checkpoint, io, run } = closedRun;
		await beads.close(scope, run.id, { force: true });
		expect(await prepareDriver(run.id, {}, io).catch((error: unknown) => error)).toMatchObject({
			reason: "run_not_ready",
		});
		expect(await beads.show(scope, run.id)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
	});

	test("handoff does not steal a retained checkpoint lock", async () => {
		const { beads, checkpoint, io, run } = lockedRun;
		const notes = JSON.stringify({ owner: "other-operation", pid: 22 });
		await beads.update(scope, [checkpoint], { notes });
		let now = FIRST;
		const failure: unknown = await prepareDriver(
			run.id,
			{},
			{
				...io,
				now: () => now,
				sleep: () => {
					now += LOCK_TIMEOUT;
					return Promise.resolve();
				},
			},
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({ reason: "checkpoint_locked" });
		expect(await beads.show(scope, checkpoint)).toMatchObject({ notes });
		expect(await beads.show(scope, run.id)).toMatchObject({
			status: "in_progress",
		});
	});

	test("uncertain handoff write retains ownership and reports partial effects", async () => {
		const { beads, checkpoint, io, run } = failedWrite;
		const failure: unknown = await prepareDriver(
			run.id,
			{},
			{
				...io,
				beads: {
					...beads,
					update: (selected, ids, input) => {
						if (ids.includes(run.id)) {
							return Promise.reject(new Error("write failed"));
						}
						return beads.update(selected, ids, input);
					},
				},
			},
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({
			reason: "partial_effects",
			context: { checkpoint, runId: run.id },
		});
		const { notes } = await beads.show(scope, checkpoint);
		expect(notes).not.toBe("");
	});

	test("replacement driver collects a closed visit once alongside its independent run response", async () => {
		const { beads, checkpoint, io, run } = resumed;
		await beads.update(scope, [run.active[FIRST]!.bead], {
			notes: JSON.stringify({ choice: "selected", data: payload }),
		});
		await beads.close(scope, run.active[FIRST]!.bead);
		await prepareDriver(run.id, {}, io);
		const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(next.active[FIRST]!.context["saved"]).toEqual(payload);
		expect(next.active[FIRST]!.bead).not.toBe(run.active[FIRST]!.bead);
		expect(await navigate({ id: run.id, operation: "collect" }, {}, io)).toEqual(next);
		expect(readCheckpoint(await beads.show(scope, checkpoint)).history).toEqual([
			{
				bead: run.active[FIRST]!.bead,
				command: "selected",
				data: payload,
				request: run.active[FIRST]!.request,
			},
		]);
		expect(await beads.show(scope, resumedResponse.id)).toMatchObject({
			description: resumedResponse.description,
			status: "closed",
			updated_at: resumedResponse.updated_at,
		});
	});

	test.each(invalidNotes)(
		"closed driver-handled result fails visibly with stage identity: %s",
		async (notes) => {
			const { beads, checkpoint, io, run } = invalidRuns.get(notes)!;
			const { bead } = run.active[FIRST]!;
			await beads.update(scope, [bead], { notes });
			await beads.close(scope, bead);
			const result = await invoke(["collect", run.id], io);
			expect(result.code).toBe(FAILURE);
			expect(result.document).toMatchObject({ reason: "invalid_stage_result", bead });
			expect(readCheckpoint(await beads.show(scope, checkpoint)).history).toEqual([]);
			expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
		},
	);

	test("handoff preserves an existing agent driver claim", async () => {
		const { beads, io, run } = assignedRun;
		await beads.update(scope, [run.id], { assignee: "existing-driver" });
		const result = await invoke(["prepare-driver", run.id], io);
		expect(result.document).toMatchObject({
			reason: "run_assigned",
			runId: run.id,
			assignee: "existing-driver",
		});
		expect(await beads.show(scope, run.id)).toMatchObject({
			status: "in_progress",
			assignee: "existing-driver",
		});
	});

	// Verify raw persisted input and transformed continuation across native closure.
	// eslint-disable-next-line max-statements
	test("record-result saves original input before closure and consumes transforms once", async () => {
		const { beads, checkpoint, io, run } = transformed;
		const { bead } = run.active[FIRST]!;
		const data = { choice: "payload-specific-choice", value: "13" };
		const result = await invoke(
			["record-result", run.id, bead, "selected", "--data", JSON.stringify(data)],
			io,
		);
		expect(result.document).toEqual({
			ok: true,
			kind: "record-result",
			runId: run.id,
			stageId: bead,
			choice: "selected",
		});
		expect(await beads.show(scope, bead)).toMatchObject({
			status: "in_progress",
			notes: JSON.stringify({ choice: "selected", data }),
		});
		expect(readCheckpoint(await beads.show(scope, checkpoint)).history).toEqual([]);
		await beads.close(scope, bead);
		const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(next.active[FIRST]!.context["saved"]).toEqual({ choice: data.choice, value: 13 });
	});

	test("record-result preserves conflicting results and rejects writes after closure", async () => {
		const { beads, io, run } = conflicting;
		const { bead } = run.active[FIRST]!;
		const request = { id: run.id, bead, choice: "selected", data: payload };
		await recordResult(request, {}, io);
		await recordResult(request, {}, io);
		const saved = await beads.show(scope, bead);
		expect(
			await recordResult({ ...request, data: { ...payload, answer: ["different"] } }, {}, io).catch(
				(error: unknown) => error,
			),
		).toMatchObject({ reason: "stage_result_conflict", context: { bead } });
		expect(await beads.show(scope, bead)).toEqual(saved);
		await beads.close(scope, bead);
		expect(await recordResult(request, {}, io).catch((error: unknown) => error)).toMatchObject({
			reason: "task_closed",
		});
	});
	test("record-result rejects invalid input before task closure or progression", async () => {
		const { beads, checkpoint, io, run } = invalidInput;
		const { bead } = run.active[FIRST]!;
		const result = await invoke(
			["record-result", run.id, bead, "selected", "--data", '{"answer":7}'],
			io,
		);
		expect(result.document).toMatchObject({ reason: "invalid_input", kind: "record-result" });
		expect(await beads.show(scope, bead)).toMatchObject({ notes: "", status: "in_progress" });
		expect(readCheckpoint(await beads.show(scope, checkpoint)).history).toEqual([]);
	});

	test("record-result supports an array payload through driver collection", async () => {
		const { beads, io, run } = arrayRun;
		const { bead } = run.active[FIRST]!;
		const data = ["standalone", "array"];
		await recordResult({ id: run.id, bead, choice: "selected", data }, {}, io);
		await beads.close(scope, bead);
		const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
		expect(next.active[FIRST]!.context["saved"]).toEqual(data);
	});
});

async function beeFixture() {
	const beads = createMemoryBeads({ db });
	const calls: string[][] = [];
	const io: Services = {
		...createServices(),
		actor: "caller",
		beads,
		cwd: repo,
		importModule: () => Promise.resolve(beeDefinition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		execute: async (argv) => {
			calls.push(argv);
			const request = await beads.create(scope, {
				title: "Bee dispatch request",
				owner: "ct",
				assignee: "stage-worker",
				labels: spawnRequestLabels("worker"),
				description: JSON.stringify({
					...recipe,
					assignment: {
						kind: "stage",
						runId: argv[RECIPE_RUN_ARG],
						stageId: argv[RECIPE_STAGE_ARG],
					},
				}),
			});
			await beads.dep.add(scope, request.id, argv[RECIPE_STAGE_ARG]!, "related");
			return JSON.stringify({ ok: true, request: { id: request.id } });
		},
	};
	const parent = await beads.create(scope, { title: "Original work", owner: "ct" });
	const run = await start("workflow.ts", { owner: "ct", assignee: "", parent: parent.id }, io);
	return { beads, calls, io, run, stage: run.active[FIRST]! };
}

const dispatch = await beeFixture();
const ended = new Map(
	await Promise.all(
		["blocked", "cancelled"].map(async (reason) => [reason, await beeFixture()] as const),
	),
);
const closedStage = await beeFixture();
await closedStage.beads.close(scope, closedStage.stage.request!, { reason: "blocked" });
const stageResponse = await filedResponse(
	closedStage,
	closedStage.stage.bead,
	closedStage.stage.request!,
);
await recordResult(
	{ id: closedStage.run.id, bead: closedStage.stage.bead, choice: "selected", data: payload },
	{},
	closedStage.io,
);
await closedStage.beads.close(scope, closedStage.stage.bead);
await Promise.all(
	[...ended.values()].map((current) =>
		filedResponse(current, current.stage.bead, current.stage.request!),
	),
);
const replacementStage = await replacementFixture();
// Warm the distinct supersedes decoding path before measuring continuation.
const retryWarmup = await replacementFixture();
await navigate({ id: retryWarmup.run.id, operation: "collect" }, {}, retryWarmup.io);

describe("Bee-dispatched stage coordination", () => {
	test("Bee dispatch uses the stage seam and response target with the existing run and endpoint", async () => {
		const { calls, run, stage } = dispatch;
		expect(calls[FIRST]!.slice(FIRST, DISPATCH_PREFIX)).toEqual([
			"bee",
			"dispatch-stage",
			"worker",
			stage.bead,
			"--run",
			run.id,
		]);
		expect(calls[FIRST]).toEqual(
			expect.arrayContaining([
				"--repo",
				repo,
				"--beads-db",
				db,
				"--actor",
				"caller",
				"--cwd",
				"--prompt",
				"--json",
			]),
		);
		const prompt = calls[FIRST]![calls[FIRST]!.indexOf("--prompt") + ONE]!;
		expect(prompt).toContain(renderResponseInstructions({ taskId: stage.bead }));
		expect(prompt).not.toContain(renderResponseInstructions({ taskId: run.id }));
		const task = await dispatch.beads.show(scope, stage.bead);
		expect(task.description).toContain(renderResponseInstructions({ taskId: "TASK_ID" }));
		expect(task.description).not.toContain(renderResponseInstructions({ taskId: run.id }));
	});

	test.each(["blocked", "cancelled"])(
		"Bee dispatch request ending %s without a closed stage fails visibly",
		async (reason) => {
			const { beads, io, run, stage } = ended.get(reason)!;
			await beads.close(scope, stage.request!, { reason });
			const result = await invoke(["collect", run.id], io);
			expect(result.code).toBe(FAILURE);
			expect(result.document).toMatchObject({
				reason: "bee_execution_unsuccessful",
				bead: stage.bead,
				request: stage.request,
			});
		},
	);

	test("closed stage result is collected with its response independently of a blocked request", async () => {
		const { beads, io, run } = closedStage;
		expect(await navigate({ id: run.id, operation: "collect" }, {}, io)).toMatchObject({
			status: "done",
			active: [],
		});
		expect(await beads.show(scope, run.id)).toMatchObject({ status: "closed" });
		expect(await beads.show(scope, closedStage.stage.bead)).toMatchObject({
			notes: JSON.stringify({ choice: "selected", data: payload }),
		});
		expect(await beads.show(scope, stageResponse.id)).toMatchObject({
			description: stageResponse.description,
			status: "closed",
			updated_at: stageResponse.updated_at,
		});
	});

	test("collection follows a pending replacement and reports its terminal failure", async () => {
		const { beads, io, run, replacement } = replacementStage;
		expect(await navigate({ id: run.id, operation: "collect" }, {}, io)).toEqual(run);
		await beads.close(scope, replacement, { reason: "exhausted" });
		const result = await invoke(["collect", run.id], io);
		expect(result.document).toMatchObject({
			reason: "bee_execution_unsuccessful",
			request: replacement,
		});
	});
});

/** Generic filed artifact fixture; Busy Bee consumes machine outcomes, not response storage. */
async function filedResponse(
	current: Awaited<ReturnType<typeof fixture>> | Awaited<ReturnType<typeof beeFixture>>,
	taskId: string,
	requestId?: string,
) {
	let author = scope.actor;
	const deps = [{ id: taskId, type: "replies-to" }];
	if (requestId) {
		const request = await current.beads.show(scope, requestId);
		author = request.assignee!;
		deps.push({ id: requestId, type: "related" });
	}
	const created = await current.beads.create(
		{ ...scope, actor: author },
		{
			title: "Filed response",
			owner: "ct",
			type: "docs",
			status: "closed",
			labels: ["response"],
			description: JSON.stringify({
				formatVersion: 1,
				taskId,
				requestId,
				author,
				body: "Complete authored report or blocker with required next action.",
				supersedes: [],
			}),
			deps,
		},
	);
	return current.beads.show(scope, created.id);
}

async function replacementFixture() {
	const current = await beeFixture();
	const { beads, run, stage } = current;
	await beads.close(scope, stage.request!, { reason: "blocked" });
	const replacement = await beads.create(scope, {
		title: "Retry",
		owner: "ct",
		assignee: "replacement-worker",
		labels: spawnRequestLabels("worker"),
		description: JSON.stringify({
			...recipe,
			assignment: { kind: "stage", runId: run.id, stageId: stage.bead },
		}),
	});
	await beads.dep.add(scope, replacement.id, stage.bead, "related");
	await beads.dep.add(scope, replacement.id, stage.request!, "supersedes");
	return { ...current, replacement: replacement.id };
}

describe("default catalogue installation", () => {
	test("init installs at the catalogue root from a nested directory without tracker discovery", async () => {
		const requests: Parameters<Services["installWorkflow"]>[typeof FIRST][] = [];
		const roots: { argv: string[]; cwd: string }[] = [];
		const io = {
			...createServices(),
			canResolve: () => Promise.resolve(false),
			cwd: repo,
			execute: (argv: string[], cwd: string) => {
				roots.push({ argv, cwd });
				return Promise.resolve("/another-checkout\n");
			},
			installWorkflow: (input: Parameters<Services["installWorkflow"]>[typeof FIRST]) => {
				requests.push(input);
				return Promise.resolve();
			},
		};
		const result = await invoke(["init", "--repo", "/another-checkout/nested"], io);
		expect(result.document).toEqual({
			ok: true,
			kind: "init",
			dependencies: {
				install: [
					"bun",
					"add",
					"--cwd",
					"/another-checkout/.workflows",
					"xstate@^5.33.2",
					"zod@^4.6.5",
				],
				manifest: "/another-checkout/.workflows/package.json",
				missing: ["xstate", "zod"],
				required: { xstate: "^5.33.2", zod: "^4.6.5" },
				status: "install_required",
			},
			name: "do-work",
			repo: "/another-checkout",
			source: "/another-checkout/.workflows/do-work/workflow.ts",
			version: "1.0.0",
		});
		expect(roots).toEqual([
			{ argv: ["git", "rev-parse", "--show-toplevel"], cwd: "/another-checkout/nested" },
		]);
		expect(requests).toEqual([
			{
				directory: "/another-checkout/.workflows/do-work",
				manifest: expect.stringContaining('version = "1.0.0"'),
				packageManifest: expect.stringContaining('"xstate": "^5.33.2"'),
				source: expect.stringContaining('id: "do-work"'),
			},
		]);
	});
	test("init reports native exclusive-installation failure without hiding it", async () => {
		const io = {
			...createServices(),
			cwd: repo,
			execute: () => Promise.resolve(repo),
			installWorkflow: () => Promise.reject(new Error("Existing workflow directory")),
		};
		const result = await invoke(["init"], io);
		expect(result.code).toBe(FAILURE);
		expect(result.document).toMatchObject({ ok: false, kind: "init", reason: "command_failed" });
	});
});
