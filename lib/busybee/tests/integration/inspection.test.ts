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
test("#test-206 system preview freezes active briefs and renders retained actor contexts without effects", async () => {
	const fixture = await inspectionFixture();
	const before = await fixture.records();
	const result = await captureCli(
		[...command, "inspect", fixture.id, "--diagram", "--instructions", "--json"],
		fixture.services,
	);
	expect(result.code, result.stdout).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const envelope = JSON.parse(result.stdout);
	const document = envelope.diagram.data;
	expect(envelope).toMatchObject({
		ok: true,
		kind: "workflow_lifecycle",
		diagram: { kind: "available" },
	});
	expect(document).toMatchObject({ formatVersion: 1 });
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

// eslint-disable-next-line max-statements -- Verify opt-in privacy and no-effect boundaries across both graph modes.
test("#test-203 public inspection expands structure and instructions explicitly without native effects", async () => {
	const fixture = await inspectionFixture();
	const before = await fixture.records();
	const structural = await captureCli(
		[...command, "inspect", fixture.id, "--diagram", "--json"],
		fixture.services,
	);
	expect(structural.code).toBe(SUCCESS);
	expect(JSON.parse(structural.stdout)).toMatchObject({
		diagram: { kind: "available", mode: "structure" },
	});
	expect(structural.stdout).not.toContain('"instructions"');
	expect(structural.stdout).not.toContain("private-secret");
	expect(fixture.rendered()).toEqual([]);
	const expanded = await captureCli(
		[...command, "inspect", fixture.id, "--diagram", "--instructions", "--json"],
		fixture.services,
	);
	expect(expanded.code).toBe(SUCCESS);
	expect(JSON.parse(expanded.stdout)).toMatchObject({
		diagram: {
			kind: "available",
			mode: "instructions",
			data: {
				actors: [
					{ instructions: { "flow.work": { kind: "frozen", instructions: "Original brief" } } },
					{},
				],
			},
		},
	});
	expect(expanded.stdout).not.toContain("private-secret");
	expect(await fixture.records()).toEqual(before);
});

test(
	"#test-204 public schema includes expansion failures " +
		"and lone instructions reject before tracker access",
	async () => {
		const services = { ...createServices(), execute: forbidden };
		const schema = await captureCli(["inspect", "--schema", "--json"], services);
		expect(schema.code).toBe(SUCCESS);
		expect(JSON.parse(schema.stdout)).toMatchObject({
			schema: { properties: { diagram: { anyOf: expect.any(Array) } } },
		});
		const invalid = await captureCli(["inspect", "missing", "--instructions", "--json"], services);
		expect(invalid.code).toBe(FAILURE);
		expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, reason: "usage" });
	},
);

test("ordinary preview stays structural and never invokes instruction renderers", async () => {
	const fixture = await inspectionFixture();
	const result = await captureCli(
		[...command, "inspect", fixture.id, "--diagram", "--json"],
		fixture.services,
	);
	expect(result.code).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	const envelope = JSON.parse(result.stdout);
	const document = envelope.diagram.data;
	expect(envelope).toMatchObject({
		ok: true,
		kind: "workflow_lifecycle",
		diagram: { kind: "available" },
	});
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
		kind: "workflow_lifecycle_schema",
		schema: {
			properties: {
				lifecycle: expect.any(Object),
				kind: { const: "workflow_lifecycle" },
				diagram: expect.any(Object),
			},
		},
	});
	const human = await captureCli(["system", "checkpoint", "run"], services);
	expect(human.code).toBe(FAILURE);
	expect(human.stdout).toBe("");
	expect(human.stderr).toContain("--json");
});

test("unavailable diagram preserves native lifecycle before rendering callbacks", async () => {
	const fixture = await inspectionFixture("missing");
	const result = await captureCli(
		[...command, "inspect", fixture.id, "--diagram", "--instructions", "--json"],
		fixture.services,
	);
	expect(result.code).toBe(SUCCESS);
	expect(result.stderr).toBe("");
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		kind: "workflow_lifecycle",
		lifecycle: { kind: "pending" },
		diagram: { kind: "unavailable", reason: "preview_unavailable" },
	});
	expect(fixture.rendered()).toEqual([]);
});

test("#test-207 checkpoint version reads no definition or callbacks and performs no writes", async () => {
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

test("#test-208 checkpoint schema is available without tracker access", async () => {
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
