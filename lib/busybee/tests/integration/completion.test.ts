import { BusyBeeError, createServices } from "../../src/native.ts";
import { assign, createMachine } from "xstate";
import { complete, discover, navigate, recordResult, start } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import type { UpdateBead } from "@hive/beads";
import { createMemoryBeads } from "@hive/beads";
import { invoke } from "./support.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const repo = "/completion-repo";
const db = "/completion-tracker/beads.db";
const scope = { actor: "worker", cwd: repo, db };
const data = { value: "13", extra: ["original", "payload"] };
const resultShape = z.object({ value: z.string().transform(Number), extra: z.array(z.string()) });
const definition = {
	inputSchema: z.object({}),
	commandSchemas: {
		next: z.compile(resultShape),
	},
	runBrief: () => ({ title: "Completion", description: "Complete work" }),
	machine: createMachine({
		id: "completion",
		context: { saved: {} },
		initial: "work",
		states: {
			work: {
				meta: { title: "Work", commands: { next: "NEXT" }, task: () => ({ instructions: "Work" }) },
				on: { NEXT: { target: "done", actions: assign({ saved: ({ event }) => event.data }) } },
			},
			done: { type: "final" },
		},
	}),
};

async function fixture() {
	const beads = createMemoryBeads({ db });
	const io: Services = {
		...createServices(),
		actor: scope.actor,
		beads,
		cwd: repo,
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
	};
	const parent = await beads.create(scope, { title: "Parent", owner: "ct" });
	const run = await start("workflow.ts", { owner: "ct", parent: parent.id }, io);
	const root = await beads.show(scope, run.id);
	const checkpoint = root.dependencies.find((edge) => edge.dependency_type === "related")!.id;
	const request = { id: run.id, bead: run.active[FIRST]!.bead, choice: "next", data };
	return { beads, checkpoint, io, request, run };
}

const barriers = ["result", "checkpoint", "release"];
const pending = new Map(
	await Promise.all(barriers.map(async (point) => [point, await fixture()] as const)),
);
const failed = new Map(
	await Promise.all(barriers.map(async (point) => [point, await fixture()] as const)),
);
const refusal = await fixture();
const lostReceipt = await fixture();
const invalid = await fixture();
const reordered = await fixture();
const reserved = await fixture();
const invalidEvidence = [
	{ notes: "", reason: "invalid_stage_result" },
	{ notes: "{", reason: "invalid_stage_result" },
	{ notes: '{"choice":"next"}', reason: "invalid_stage_result" },
	{ notes: '{"choice":"next","data":{"value":"different"}}', reason: "stage_result_conflict" },
];
const conflicts = new Map(
	await Promise.all(invalidEvidence.map(async ({ notes }) => [notes, await fixture()] as const)),
);
const invalidClosed = [
	{ choice: "next", payload: { ...data, value: 13 }, reason: "invalid_input" },
	{ choice: "missing", payload: data, reason: "unavailable_command" },
];
const invalidClosedRuns = new Map(
	await Promise.all(invalidClosed.map(async ({ reason }) => [reason, await fixture()] as const)),
);
const warmup = await fixture();
await invoke(
	["complete", warmup.run.id, warmup.request.bead, "next", "--data", JSON.stringify(data)],
	warmup.io,
);
await navigate({ id: warmup.run.id, operation: "collect" }, {}, warmup.io);

// Promise barriers cover every awaited publication boundary without clock races.

test.each(barriers)(
	"complete cannot close while %s persistence is pending #test-450",
	// eslint-disable-next-line max-statements
	async (point) => {
		const { beads, checkpoint, io, request } = pending.get(point)!;
		const reached = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let closes = FIRST;
		const completing = complete(
			request,
			{},
			{
				...io,
				beads: {
					...beads,
					update: async (selected, ids, input) => {
						const selectedPoint = writePoint(ids, input, request.bead);
						if (point === selectedPoint) {
							reached.resolve();
							await release.promise;
						}
						return beads.update(selected, ids, input);
					},
					close: async (selected, id, input) => {
						closes += ONE;
						expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
						return beads.close(selected, id, input);
					},
				},
			},
		);
		await reached.promise;
		expect(closes).toBe(FIRST);
		expect(await beads.show(scope, request.bead)).toMatchObject({ status: "in_progress" });
		release.resolve();
		await completing;
		expect(closes).toBe(ONE);
		expect(await beads.show(scope, request.bead)).toMatchObject({
			status: "closed",
			notes: JSON.stringify({ choice: "next", data }),
		});
	},
);

test.each(barriers)("failed %s publication never attempts closure #test-526", async (point) => {
	const { beads, checkpoint, io, request } = failed.get(point)!;
	let closes = FIRST;
	const result = await complete(
		request,
		{},
		{
			...io,
			beads: {
				...beads,
				update: (selected, ids, input) => {
					const selectedPoint = writePoint(ids, input, request.bead);
					if (point === selectedPoint) {
						return Promise.reject(new Error("publication failed"));
					}
					return beads.update(selected, ids, input);
				},
				close: (selected, id, input) => {
					closes += ONE;
					return beads.close(selected, id, input);
				},
			},
		},
	).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(BusyBeeError);
	expect(result).toMatchObject({ reason: "partial_effects", context: { checkpoint } });
	expect(closes).toBe(FIRST);
	expect(await beads.show(scope, request.bead)).toMatchObject({ status: "in_progress" });
});

// Native child gates remain the close adapter's responsibility after successful saving.
// eslint-disable-next-line max-statements
test("native closure refusal preserves exact result and releases checkpoint for retry #test-396", async () => {
	const { beads, checkpoint, io, request } = refusal;
	const child = await beads.create(scope, {
		title: "Remaining child",
		owner: "ct",
		parent: request.bead,
	});
	const result = await invoke(
		["complete", request.id, request.bead, "next", "--data", JSON.stringify(data)],
		io,
	);
	expect(result).toMatchObject({
		code: ONE,
		document: {
			ok: false,
			kind: "complete",
			reason: "stage_close_failed",
			resultSaved: true,
			runId: request.id,
			stageId: request.bead,
		},
	});
	const saved = await beads.show(scope, request.bead);
	expect(saved).toMatchObject({
		status: "in_progress",
		notes: JSON.stringify({ choice: "next", data }),
	});
	expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
	await beads.close(scope, child.id);
	await complete(request, {}, io);
	expect(await beads.show(scope, request.bead)).toMatchObject({
		status: "closed",
		notes: saved.notes,
	});
});

// A lost native close receipt is reconciled from saved original input and native closure.
// eslint-disable-next-line max-statements
test("identical retry after lost receipt and collection never recloses or rewrites the stage #test-370", async () => {
	const { beads, checkpoint, io, request, run } = lostReceipt;
	let closes = FIRST;
	const lost: Services = {
		...io,
		beads: {
			...beads,
			close: async (selected, id, input) => {
				closes += ONE;
				await beads.close(selected, id, input);
				throw new Error("close receipt lost");
			},
		},
	};
	await expect(complete(request, {}, lost)).rejects.toBeInstanceOf(Error);
	const saved = await beads.show(scope, request.bead);
	expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
	await complete(request, {}, lost);
	const next = await navigate({ id: run.id, operation: "collect" }, {}, io);
	expect(next).toMatchObject({ status: "done", active: [], created: run.created });
	await complete(request, {}, lost);
	expect(closes).toBe(ONE);
	expect(await beads.show(scope, request.bead)).toMatchObject({
		notes: saved.notes,
		updated_at: saved.updated_at,
		closed_at: saved.closed_at,
	});
	const state = readCheckpoint(await beads.show(scope, checkpoint));
	expect(state.history).toEqual([
		{
			bead: request.bead,
			command: "next",
			data: { ...data, value: 13 },
			request: run.active[FIRST]!.request,
		},
	]);
	expect(state.snapshot).toMatchObject({ context: { saved: { ...data, value: 13 } } });
	expect(await navigate({ id: run.id, operation: "collect" }, {}, io)).toEqual(next);
});

test("complete validates payload before saving or closing #test-404", async () => {
	const { beads, checkpoint, io, request } = invalid;
	const result = await invoke(
		["complete", request.id, request.bead, "next", "--data", '{"value":13}'],
		io,
	);
	expect(result).toMatchObject({
		code: ONE,
		document: { ok: false, kind: "complete", reason: "invalid_input" },
	});
	expect(await beads.show(scope, request.bead)).toMatchObject({ status: "in_progress", notes: "" });
	expect(await beads.show(scope, checkpoint)).toMatchObject({ notes: "" });
});

test.each(invalidEvidence)(
	"closed visit refuses $reason evidence: $notes",
	async ({ notes, reason }) => {
		const { beads, io, request } = conflicts.get(notes)!;
		await beads.update(scope, [request.bead], { notes });
		await beads.close(scope, request.bead);
		const saved = await beads.show(scope, request.bead);
		const failure: unknown = await complete(request, {}, io).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BusyBeeError);
		expect(failure).toMatchObject({ reason });
		expect(await beads.show(scope, request.bead)).toEqual(saved);
	},
);

test.each(invalidClosed)(
	"closed active visit validates matching saved $reason evidence #test-433",
	async ({ choice, payload, reason }) => {
		const { beads, io, request } = invalidClosedRuns.get(reason)!;
		await beads.update(scope, [request.bead], { notes: JSON.stringify({ choice, data: payload }) });
		await beads.close(scope, request.bead);
		const saved = await beads.show(scope, request.bead);
		const result = await invoke(
			["complete", request.id, request.bead, choice, "--data", JSON.stringify(payload)],
			io,
		);
		expect(result.document).toMatchObject({ ok: false, kind: "complete", reason });
		expect(await beads.show(scope, request.bead)).toEqual(saved);
	},
);

test("matching open original payload accepts object key reordering without rewriting #test-397", async () => {
	const { beads, io, request } = reordered;
	await recordResult(request, {}, io);
	const saved = await beads.show(scope, request.bead);
	const result = await invoke(
		[
			"complete",
			request.id,
			request.bead,
			"next",
			"--data",
			JSON.stringify({ extra: data.extra, value: data.value }),
		],
		io,
	);
	expect(result.document).toEqual({
		ok: true,
		kind: "complete",
		runId: request.id,
		stageId: request.bead,
		choice: "next",
	});
	expect(await beads.show(scope, request.bead)).toMatchObject({
		notes: saved.notes,
		status: "closed",
	});
});

test("human reserved stage remains open without saved results", async () => {
	const { beads, io, request } = reserved;
	await beads.update(scope, [request.bead], { labels: ["hitl"] });
	const result = await invoke(
		["complete", request.id, request.bead, "next", "--data", JSON.stringify(data)],
		io,
	);
	expect(result.document).toMatchObject({ reason: "human_reserved", bead: request.bead });
	expect(await beads.show(scope, request.bead)).toMatchObject({ status: "in_progress", notes: "" });
});

test("generated worker guidance and discovery expose complete followed by driver collection", async () => {
	const { beads, io, request } = warmup;
	const stage = await beads.show(scope, request.bead);
	expect(stage.description).toContain(`complete ${request.id} TASK_ID CHOICE`);
	expect(stage.description).not.toContain("before br close");
	const discovery = await discover(request.id, {}, io);
	expect(discovery.constraints).toContain("complete");
});

function writePoint(ids: readonly string[], input: UpdateBead, stage: string): string {
	if (ids.includes(stage)) {
		return "result";
	}
	if (input.description) {
		return "checkpoint";
	}
	if (input.notes === "") {
		return "release";
	}
	return "acquire";
}
