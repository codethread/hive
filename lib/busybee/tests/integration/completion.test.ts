import { BusyBeeError, createServices } from "../../src/native.ts";
import { assign, createMachine, initialTransition } from "xstate";
import { complete, recordResult } from "../../src/runtime.ts";
import { expect, test } from "bun:test";
import type { Run } from "../../src/checkpoint.ts";
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

// eslint-disable-next-line max-statements
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
	const run = await beads.create(scope, {
		title: "Completion",
		owner: "ct",
		status: "in_progress",
		labels: ["busybee-workflow"],
	});
	const stage = await beads.create(scope, {
		title: "Work",
		owner: "ct",
		parent: run.id,
		status: "in_progress",
		labels: ["busybee-workflow"],
	});
	const saved: Run = {
		formatVersion: 1,
		id: run.id,
		definition: { kind: "source", source: `${repo}/workflow.ts` },
		hash: new Bun.CryptoHasher("sha256").update(new ArrayBuffer(FIRST)).digest("hex"),
		snapshot: definition.machine.getPersistedSnapshot(initialTransition(definition.machine)[FIRST]),
		active: [
			{
				bead: stage.id,
				context: { saved: {} },
				key: ":completion.work",
				node: "completion.work",
				parent: run.id,
				path: [],
				// eslint-disable-next-line unicorn/no-null
				request: null,
				meta: { title: "Work", instructions: "Work", commands: { next: "NEXT" } },
			},
		],
		created: [
			{
				bead: stage.id,
				node: "completion.work",
				parent: run.id,
				path: [],
				// eslint-disable-next-line unicorn/no-null
				request: null,
				visit: 1,
			},
		],
		history: [],
		visits: { ":completion.work": 1 },
	};
	const checkpoint = await beads.create(scope, {
		title: "Checkpoint",
		owner: "ct",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify(saved),
	});
	await beads.dep.add(scope, run.id, checkpoint.id, "related");
	const request = { id: run.id, bead: stage.id, choice: "next", data };
	return { beads, checkpoint: checkpoint.id, io, request };
}

const barriers = ["result", "checkpoint", "release"];

test.each(barriers)("failed %s publication never attempts closure #test-526", async (point) => {
	const { beads, checkpoint, io, request } = await fixture();
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
	const { beads, io, request } = await fixture();
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
	const { beads, io, request } = await fixture();
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
