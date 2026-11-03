/* eslint-disable unicorn/no-null -- Saved checkpoints encode absent requests as null. */
import { expect, test } from "bun:test";
import type { Definition } from "../../src/definition.ts";
import type { Run } from "../../src/checkpoint.ts";
import { captureCli } from "./support.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { workflowPreviewSchema } from "@hive/shared";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const FIRST = 0;
const ACTOR_COUNT = 2;
const repo = "/inspection";
const db = "/tracker/beads.db";
const command = ["--repo", repo, "--db", db];

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
