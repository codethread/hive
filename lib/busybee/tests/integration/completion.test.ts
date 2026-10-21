import { BusyBeeError, createServices } from "../../src/native.ts";
import { assign, createMachine } from "xstate";
import { complete, navigate, recordResult, start } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import type { UpdateBead } from "@hive/beads";
import { createMemoryBeads } from "@hive/beads";
import { invoke } from "./support.ts";
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
const failed = new Map(
	await Promise.all(barriers.map(async (point) => [point, await fixture()] as const)),
);
const reordered = await fixture();
const reserved = await fixture();
const warmup = await fixture();
await invoke(
	["complete", warmup.run.id, warmup.request.bead, "next", "--data", JSON.stringify(data)],
	warmup.io,
);
await navigate({ id: warmup.run.id, operation: "collect" }, {}, warmup.io);

// Promise barriers cover every awaited publication boundary without clock races.

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

test("human reserved stage remains open without saved results #test-578", async () => {
	const { beads, io, request } = reserved;
	await beads.update(scope, [request.bead], { labels: ["hitl"] });
	const result = await invoke(
		["complete", request.id, request.bead, "next", "--data", JSON.stringify(data)],
		io,
	);
	expect(result.document).toMatchObject({ reason: "human_reserved", bead: request.bead });
	expect(await beads.show(scope, request.bead)).toMatchObject({ status: "in_progress", notes: "" });
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
