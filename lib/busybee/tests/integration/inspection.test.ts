/* eslint-disable unicorn/no-null -- Saved checkpoints encode absent requests as null. */
import { expect, test } from "bun:test";
import { workflowInspectionSchema, workflowPreviewSchema } from "@hive/shared";
import type { Definition } from "../../src/definition.ts";
import type { Run } from "../../src/checkpoint.ts";
import { captureCli } from "./support.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const FIRST = 0;
const CHILD = 1;
const ACTOR_COUNT = 2;
const repo = "/inspection";
const db = "/tracker/beads.db";
const command = ["--repo", repo, "--db", db];

// eslint-disable-next-line max-statements -- Verify the complete public payload and no-effect boundary together.
test("system preview freezes active briefs and renders retained actor contexts without effects", async () => {
	const fixture = await inspectionFixture();
	const before = await fixture.records();
	const result = await captureCli(
		[...command, "system", "preview", fixture.id, "--json"],
		fixture.services,
	);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const document = JSON.parse(result.stdout);
	expect(document).toMatchObject({ ok: true, kind: "workflow_inspection", formatVersion: 1 });
	const inspection = workflowInspectionSchema.parse(document);
	expect(inspection.definition).toMatchObject({
		savedHash: "old-source",
		sourceMatch: "compatible",
	});
	expect(inspection.actors[FIRST]).toMatchObject({
		path: [],
		snapshot: { value: "work", status: "active" },
		machine: { states: { work: { invoke: [{ id: "worker", src: "xstate.invoke.0.flow.work" }] } } },
		instructions: {
			flow: { kind: "none" },
			"flow.work": {
				kind: "frozen",
				title: "Published",
				instructions: "Original brief",
				bead: "visit",
			},
			"flow.future": { kind: "rendered", title: "Preview root", instructions: "Saved root" },
			"flow.broken": { kind: "unavailable", message: "Needs future input" },
			"flow.done": { kind: "none" },
		},
	});
	expect(inspection.actors[FIRST]!.machine).toHaveProperty("states.work.invoke", [
		{ id: "worker", src: "xstate.invoke.0.flow.work" },
	]);
	expect(inspection.actors[CHILD]).toMatchObject({
		path: ["worker"],
		snapshot: { value: "work", status: "stopped" },
		instructions: {
			"flow.work": { kind: "rendered", title: "Child", instructions: "Saved child" },
		},
	});
	expect(fixture.rendered()).toEqual(["root", "child"]);
	expect(result.stdout).not.toContain("private-secret");
	expect(await fixture.records()).toEqual(before);
});

test("ordinary preview stays structural and never invokes instruction renderers", async () => {
	const fixture = await inspectionFixture();
	const result = await captureCli([...command, "preview", fixture.id, "--json"], fixture.services);
	expect(result.code).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const document = JSON.parse(result.stdout);
	expect(document).toMatchObject({ ok: true, kind: "workflow_preview" });
	expect(workflowPreviewSchema.parse(document).actors).toHaveLength(ACTOR_COUNT);
	expect(result.stdout).not.toContain("instructions");
	expect(fixture.rendered()).toEqual([]);
});

test("system schema is discoverable without tracker access and tooling requires JSON", async () => {
	const services = createServices();
	const result = await captureCli(["system", "schema", "--json"], services);
	expect(result.code).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		kind: "workflow_inspection_schema",
		schema: { properties: { formatVersion: { const: 1 }, kind: { const: "workflow_inspection" } } },
	});
	const human = await captureCli(["system", "preview", "run"], services);
	expect(human.code).toBe(FAILURE);
	expect(human.stdout).toBe("");
	expect(human.stderr).toContain("--json");
});

test("system preview fails visibly on malformed projection before rendering callbacks", async () => {
	const fixture = await inspectionFixture("missing");
	const result = await captureCli(
		[...command, "system", "preview", fixture.id, "--json"],
		fixture.services,
	);
	expect(result.code).toBe(FAILURE);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		kind: "workflow_inspection",
		reason: "preview_unavailable",
		target: fixture.id,
	});
	expect(fixture.rendered()).toEqual([]);
});

test("checkpoint version reads no definition or callbacks and performs no writes", async () => {
	const fixture = await inspectionFixture();
	const before = await fixture.records();
	const services = {
		...fixture.services,
		importModule: forbidden,
		readBytes: forbidden,
		readText: forbidden,
		readDirectory: forbidden,
	};
	const result = await captureCli(
		[...command, "system", "checkpoint", fixture.id, "--json"],
		services,
	);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toEqual({
		ok: true,
		kind: "workflow_checkpoint",
		runId: fixture.id,
		checkpoint: before[CHILD]!.id,
		savedAt: before[CHILD]!.updated_at,
	});
	expect(fixture.rendered()).toEqual([]);
	expect(await fixture.records()).toEqual(before);
});

test("checkpoint schema is available without tracker access", async () => {
	const result = await captureCli(["system", "schema", "--checkpoint", "--json"], createServices());
	expect(result.code).toBe(SUCCESS);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		kind: "workflow_checkpoint_schema",
		schema: { properties: { checkpoint: { type: "string" }, savedAt: { type: "string" } } },
	});
});

// --- Private fixtures ---

// eslint-disable-next-line max-statements -- Seed a checkpoint without workflow execution or native storage.
async function inspectionFixture(value = "work") {
	const rendered: string[] = [];
	const child = createMachine({
		id: "flow",
		initial: "work",
		entry: forbidden,
		states: {
			work: {
				meta: {
					title: "Child",
					task: ({ context }: { context: Record<string, unknown> }) => {
						rendered.push(String(context["name"]));
						return { instructions: `Saved ${String(context["name"])}` };
					},
				},
			},
		},
	});
	const definition: Definition = {
		inputSchema: z.object({}),
		commandSchemas: {},
		runBrief: forbidden,
		machine: createMachine({
			id: "flow",
			initial: "work",
			entry: forbidden,
			states: {
				work: {
					meta: { title: "Changed", task: forbidden },
					invoke: { id: "worker", src: child },
					on: { NEXT: { target: "future", guard: forbidden, actions: forbidden } },
				},
				future: {
					meta: {
						title: "Future",
						task: ({ context }: { context: Record<string, unknown> }) => {
							rendered.push(String(context["name"]));
							return {
								title: `Preview ${String(context["name"])}`,
								instructions: `Saved ${String(context["name"])}`,
							};
						},
					},
				},
				broken: {
					meta: {
						title: "Later",
						task: () => {
							throw new Error("Needs future input");
						},
					},
				},
				done: { type: "final" },
			},
		}),
	};
	const beads = createMemoryBeads({ db });
	const scope = { actor: "test-agent", cwd: repo, db };
	const parent = await beads.create(scope, { title: "Saved workflow", owner: "ct" });
	const snapshot = {
		status: "active" as const,
		output: undefined,
		error: undefined,
		value,
		context: { name: "root", secret: "private-secret" },
		children: {
			worker: {
				src: "xstate.invoke.0.flow.work",
				snapshot: {
					status: "stopped",
					value: "work",
					context: { name: "child" },
					children: {},
				},
			},
		},
	};
	const saved: Run = {
		id: parent.id,
		formatVersion: 1,
		hash: "old-source",
		definition: { kind: "named", name: "example", version: "1.0.0" },
		snapshot,
		active: [
			{
				bead: "visit",
				key: ":flow.work",
				path: [],
				node: "flow.work",
				request: null,
				context: { name: "original" },
				meta: { title: "Published", instructions: "Original brief" },
			},
		],
		created: [],
		history: [],
		visits: {},
	};
	const checkpoint = await beads.create(scope, {
		title: "Checkpoint",
		owner: "ct",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify(saved),
	});
	await beads.dep.add(scope, parent.id, checkpoint.id, "related");
	const services = {
		...createServices(),
		beads,
		cwd: repo,
		beforeWrite: forbidden,
		execute: () => Promise.resolve(repo),
		readDirectory: () => Promise.resolve([{ kind: "file" as const, name: "workflow.ts" }]),
		readText: () => Promise.resolve('description="Example"\nrun="./workflow.ts"\nversion="1.1.0"'),
		readBytes: () => Promise.resolve(new ArrayBuffer(FIRST)),
		isFile: () => Promise.resolve(true),
		importModule: () => Promise.resolve(definition),
	};
	return {
		id: parent.id,
		services,
		rendered: () => rendered,
		records: () => beads.showMany(scope, [parent.id, checkpoint.id]),
	};
}

function forbidden(): never {
	throw new Error("Inspection must not execute this operation");
}
