import { assign, createMachine } from "xstate";
import { expect, test } from "bun:test";
import { navigate, startNamed } from "../../src/runtime.ts";
import type { Services } from "../../src/native.ts";
import { assessRun } from "../../src/preflight.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { readCheckpoint } from "../../src/checkpoint.ts";
import { z } from "zod";

const FIRST = 0;
const repo = "/repo";
const db = "/tracker/beads.db";
const bytes = new TextEncoder().encode("original").buffer;
const manifest = 'description="Example"\nversion="1.0.0"\nrun="./entry.ts"';
const services: Services = {
	...createServices(),
	cwd: repo,
	isFile: () => Promise.resolve(true),
	readDirectory: () => Promise.resolve([{ kind: "file", name: "entry.ts" }]),
	readBytes: () => Promise.resolve(bytes),
	readText: () => Promise.resolve(manifest),
};
const emptyInput = z.object({});
const taskMeta = {
	title: "Step",
	task: () => ({ instructions: "Do the step" }),
	commands: { next: "NEXT" },
};
const originalChart = createMachine({
	id: "compatible",
	initial: "prepare",
	states: {
		prepare: { meta: taskMeta, on: { NEXT: "review" } },
		review: { meta: taskMeta, on: { NEXT: "finish" } },
		finish: { type: "final" },
	},
});
const proposedChart = createMachine({
	id: "compatible",
	initial: "prepare",
	states: {
		prepare: { meta: taskMeta, on: { NEXT: "extra" } },
		extra: { meta: { ...taskMeta, title: "Extra" }, on: { NEXT: "review" } },
		review: { meta: taskMeta, on: { NEXT: "finish" } },
		finish: { type: "final" },
	},
});
const commonDefinition = {
	inputSchema: emptyInput,
	commandSchemas: { next: emptyInput },
	runBrief: () => ({ title: "Run", description: "Compatible insertion" }),
};

const parallelChart = createMachine({
	id: "parallel",
	type: "parallel",
	context: { revision: "old" },
	states: {
		left: {
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Left",
						commands: { left: "LEFT" },
						task: () => ({ instructions: "Left" }),
					},
					on: { LEFT: { target: "done", actions: assign({ revision: "new" }) } },
				},
				done: { type: "final" },
			},
		},
		right: {
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Right",
						commands: { right: "RIGHT_OLD" },
						task: ({ context }: { context: Record<string, unknown> }) => {
							let event = "RIGHT_OLD";
							if (context["revision"] !== "old") {
								event = "RIGHT_NEW";
							}
							return { instructions: String(context["revision"]), commands: { right: event } };
						},
					},
					on: { RIGHT_OLD: "done", RIGHT_NEW: "done" },
				},
				done: { type: "final" },
			},
		},
	},
});
const parallelDefinition = {
	...commonDefinition,
	machine: parallelChart,
	commandSchemas: { left: emptyInput, right: emptyInput },
};

test.each(["prepare", "review"])(
	"compatible minor insertion resumes an existing run at %s",
	// eslint-disable-next-line max-statements -- Verify restore, next transition and written version as one engine lifecycle.
	async (position) => {
		const beads = createMemoryBeads({ db });
		const scope = { actor: "test-agent", cwd: repo, db };
		let machine = originalChart;
		let version = "1.0.0";
		let contents = bytes;
		const io: Services = {
			...services,
			actor: "test-agent",
			beads,
			execute: () => Promise.resolve(repo),
			importModule: () => Promise.resolve({ ...commonDefinition, machine }),
			readText: () => Promise.resolve(manifest.replace("1.0.0", version)),
			readBytes: () => Promise.resolve(contents),
		};
		let view = await startNamed("example", { owner: "ct" }, io);
		if (position === "review") {
			await beads.close(scope, view.active[FIRST]!.bead);
			view = await navigate(
				{
					id: view.id,
					operation: "submit",
					bead: view.active[FIRST]!.bead,
					choice: "next",
					data: {},
				},
				{},
				io,
			);
		}
		machine = proposedChart;
		version = "1.1.0";
		contents = new TextEncoder().encode("edited").buffer;
		await beads.close(scope, view.active[FIRST]!.bead);
		const result = await navigate(
			{
				id: view.id,
				operation: "submit",
				bead: view.active[FIRST]!.bead,
				choice: "next",
				data: {},
			},
			{},
			io,
		);
		if (position === "prepare") {
			expect(result.active).toMatchObject([{ title: "Extra" }]);
		} else {
			expect(result.status).toBe("done");
			expect(result.active).toEqual([]);
		}
		const listing = await beads.list(scope, {
			labels: ["busybee-checkpoint"],
			all: true,
			limit: 0,
		});
		const checkpoint = listing.issues.find((record) =>
			record.labels.includes("busybee-checkpoint"),
		)!;
		expect(readCheckpoint(await beads.show(scope, checkpoint.id)).definition).toEqual({
			kind: "named",
			name: "example",
			version: "1.1.0",
		});
		if (position === "prepare") {
			version = "1.0.1";
			await expect(navigate({ id: result.id, operation: "show" }, {}, io)).rejects.toMatchObject({
				reason: "definition_changed",
				context: { savedVersion: "1.1.0", proposedVersion: "1.0.1" },
			});
		}
	},
);

// eslint-disable-next-line max-statements -- Verify surviving visit publication and preflight through a complete parallel engine lifecycle.
test("parallel progress preserves a surviving visit context and preflights its unchanged frozen contract", async () => {
	const beads = createMemoryBeads({ db });
	const scope = { actor: "test-agent", cwd: repo, db };
	const io: Services = {
		...services,
		actor: "test-agent",
		beads,
		execute: () => Promise.resolve(repo),
		importModule: () => Promise.resolve(parallelDefinition),
	};
	const view = await startNamed("example", { owner: "ct" }, io);
	const left = view.active.find((entry) => entry.title === "Left")!;
	await beads.close(scope, left.bead);
	await navigate(
		{ id: view.id, operation: "submit", bead: left.bead, choice: "left", data: {} },
		{},
		io,
	);
	const listing = await beads.list(scope, { labels: ["busybee-checkpoint"], all: true, limit: 0 });
	const record = listing.issues.find((item) => item.labels.includes("busybee-checkpoint"))!;
	const saved = readCheckpoint(await beads.show(scope, record.id));
	const surviving = saved.active.find((entry) => entry.meta.title === "Right")!;
	expect(saved.snapshot).toMatchObject({ context: { revision: "new" } });
	expect(surviving.context).toEqual({ revision: "old" });
	expect(surviving.meta).toMatchObject({ instructions: "old", commands: { right: "RIGHT_OLD" } });
	const report = assessRun({
		run: saved,
		checkpoint: record.id,
		definition: parallelDefinition,
		version: "1.0.0",
	});
	expect(report.findings.filter((finding) => finding.status === "failed")).toEqual([]);
});
