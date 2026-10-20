import { expect, test } from "bun:test";
import type { Services } from "../../src/native.ts";
import { createMachine } from "xstate";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { invoke } from "./support.ts";
import { z } from "zod";

const EMPTY = 0;
const FAILURE = 1;
const NEXT = 1;
const CHECKPOINT_CREATE = 2;
const repo = "/busybee-initialization";
const source = `${repo}/workflow.ts`;
const initializationDefinition = {
	commandSchemas: { next: z.object({}) },
	inputSchema: z.object({}),
	machine: createMachine({
		initial: "work",
		states: {
			work: {
				meta: {
					title: "Worker",
					task: () => ({ instructions: "Complete work" }),
					commands: { next: "NEXT" },
				},
			},
		},
	}),
	runBrief: () => ({ title: "Example", description: "Example workflow" }),
};

async function initializationFixture() {
	const beads = createMemoryBeads({ db: `${repo}/beads.db` });
	const services: Services = {
		...createServices(),
		actor: "test-agent",
		beads,
		cwd: repo,
		execute: () => Promise.reject(new Error("Workflow behavior must not launch processes")),
		importModule: () => Promise.resolve(initializationDefinition),
		readBytes: () => Promise.resolve(new ArrayBuffer(EMPTY)),
	};
	const parent = await beads.create(
		{ actor: "test-agent", cwd: repo },
		{ title: "Original work", owner: "test-human" },
	);
	return { beads, parent, services };
}

// Warm definition/checkpoint schemas and the public command before measured failure cases.
const warmup = await initializationFixture();
await invoke(["start", source, "--owner", "test-human", "--parent", "mem-1"], warmup.services);
await invoke(["start", source, "--owner", "test-human", "--parent", "mem-1"], {
	...warmup.services,
	beads: {
		...warmup.beads,
		create: () => Promise.reject(new Error("Warm failure diagnostic")),
	},
});
await warmup.beads.list({ cwd: repo }, { all: true, limit: EMPTY });

const initializationFailures = [
	{ operation: "create_run", creates: NEXT, links: EMPTY, confirmed: {}, records: EMPTY },
	{
		operation: "create_checkpoint",
		creates: CHECKPOINT_CREATE,
		links: EMPTY,
		confirmed: { runId: "mem-1.2" },
		records: NEXT,
	},
	{
		operation: "link_checkpoint",
		creates: CHECKPOINT_CREATE,
		links: NEXT,
		confirmed: { runId: "mem-1.2", checkpoint: "mem-3" },
		records: CHECKPOINT_CREATE,
	},
];

test.each(
	initializationFailures.flatMap((entry) => [
		{ ...entry, afterWrite: false },
		{ ...entry, afterWrite: true },
	]),
)(
	"initialization reports confirmed identities when $operation fails (after write: $afterWrite) #test-463",
	// eslint-disable-next-line max-statements -- Verify the public failure envelope and retained native effects together.
	async ({ operation, creates, links, confirmed, records, afterWrite }) => {
		const { beads, parent, services } = await initializationFixture();
		let createCalls = EMPTY;
		let linkCalls = EMPTY;
		const diagnostic = new Error(`${operation} response interrupted`);
		const result = await invoke(["start", source, "--owner", "test-human", "--parent", "mem-1"], {
			...services,
			beads: {
				...beads,
				create: async (scope, input) => {
					createCalls += NEXT;
					const failing = operation !== "link_checkpoint" && createCalls === creates;
					if (failing && !afterWrite) {
						throw diagnostic;
					}
					const created = await beads.create(scope, input);
					if (failing) {
						throw diagnostic;
					}
					return created;
				},
				dep: {
					...beads.dep,
					add: async (...args) => {
						linkCalls += NEXT;
						if (!afterWrite) {
							throw diagnostic;
						}
						await beads.dep.add(...args);
						throw diagnostic;
					},
				},
			},
		});
		expect(result.code).toBe(FAILURE);
		expect(result.document).toEqual({
			...confirmed,
			parentId: "mem-1",
			kind: "start",
			message: expect.any(String),
			ok: false,
			reason: "partial_effects",
			target: source,
			uncertainOperation: operation,
		});
		const identities = Object.entries({ parentId: "mem-1", ...confirmed })
			.map(([key, value]) => `${key} ${value}`)
			.join(", ");
		expect(result.document).toMatchObject({
			message:
				"Workflow initialization failed during " +
				`${operation}` +
				"; native effects may be retained. Confirmed identities: " +
				`${identities}` +
				". Inspect the tracker for completed and uncertain effects before resubmitting.\n" +
				`${diagnostic.message}`,
		});
		const retained = await beads.list({ cwd: repo }, { all: true, limit: EMPTY });
		const effects = retained.issues.filter(({ id }) => id !== parent.id);
		const uncertainCreate = afterWrite && operation !== "link_checkpoint";
		expect(effects).toHaveLength(records + Number(uncertainCreate));
		expect(createCalls).toBe(creates);
		expect(linkCalls).toBe(links);
		for (const record of effects) {
			let status = "open";
			if (record.id === "mem-1.2") {
				status = "in_progress";
			}
			expect(record).toMatchObject({
				status,
				notes: "",
			});
		}
		if (operation === "link_checkpoint") {
			const root = await beads.show({ cwd: repo }, "mem-1.2");
			if (afterWrite) {
				expect(root.dependencies).toEqual([
					expect.objectContaining({ id: "mem-1", dependency_type: "parent-child" }),
					expect.objectContaining({ id: "mem-3", dependency_type: "related" }),
				]);
			} else {
				expect(root.dependencies).toEqual([
					expect.objectContaining({ id: "mem-1", dependency_type: "parent-child" }),
				]);
			}
		}
	},
);

test("initial visit publication failure retains parent, run and checkpoint identities #test-582", async () => {
	const { beads, parent, services } = await initializationFixture();
	const result = await invoke(["start", source, "--owner", "test-human", "--parent", parent.id], {
		...services,
		beads: {
			...beads,
			create: (scope, input) => {
				if (input.parent && input.parent !== parent.id) {
					throw new Error("Visit publication interrupted");
				}
				return beads.create(scope, input);
			},
		},
	});
	expect(result.code).toBe(FAILURE);
	expect(result.document).toMatchObject({
		ok: false,
		reason: "partial_effects",
		parentId: parent.id,
		runId: "mem-1.2",
		checkpoint: "mem-3",
		owner: expect.any(String),
	});
	const checkpoint = await beads.show({ cwd: repo }, "mem-3");
	expect(checkpoint.notes).not.toBe("");
});

test("start rejects invalid input without attempting native writes #test-431", async () => {
	const { beads, parent, services } = await initializationFixture();
	const result = await invoke(["start", source, "--owner", "test-human", "--parent", "mem-1"], {
		...services,
		beforeWrite: () => {
			throw new Error("Invalid input must not attempt writes");
		},
		importModule: () =>
			Promise.resolve({
				...initializationDefinition,
				inputSchema: z.object({ required: z.string() }),
			}),
	});
	expect(result.code).toBe(FAILURE);
	expect(result.document).toEqual({
		kind: "start",
		message: expect.any(String),
		ok: false,
		reason: "invalid_input",
		target: source,
	});
	const retained = await beads.list({ cwd: repo }, { all: true, limit: EMPTY });
	expect(retained.issues.map(({ id }) => id)).toEqual([parent.id]);
});

// eslint-disable-next-line max-statements -- Verify actor failure and unchanged records through the CLI.
test("an initial actor failure returns JSON without creating tasks #test-20", async () => {
	const beads = createMemoryBeads({ db: "/busybee-failure/beads.db" });
	const definition = {
		commandSchemas: { next: z.object({}) },
		inputSchema: z.object({}),
		machine: createMachine({
			context: () => {
				throw new Error("Initial context failure");
			},
			initial: "work",
			states: {
				work: {
					meta: {
						title: "Worker",
						task: () => ({ instructions: "Complete work" }),
						commands: { next: "NEXT" },
					},
				},
			},
		}),
		runBrief: () => ({ title: "Example", description: "Example workflow" }),
	};
	const services = {
		...createServices(),
		actor: undefined,
		beads,
		cwd: "/busybee-failure",
		execute: () => Promise.reject(new Error("Workflow behavior must not launch processes")),
		importModule: () => Promise.resolve(definition),
		readBytes: () => Promise.resolve(new ArrayBuffer(EMPTY)),
	};
	const scope = { cwd: services.cwd };
	const selection = { all: true, limit: 0 };
	const parent = await beads.create(
		{ ...scope, actor: "test-agent" },
		{ title: "Original work", owner: "test-human" },
	);
	const before = await beads.list(scope, selection);
	const result = await invoke(
		[
			"--actor",
			"test-agent",
			"--owner",
			"test-human",
			"--parent",
			parent.id,
			"start",
			"/busybee-failure/workflow.ts",
		],
		services,
	);
	expect(result.code).toBe(FAILURE);
	expect(result.document).toMatchInlineSnapshot(`
		{
		  "kind": "start",
		  "message": "Initial context failure",
		  "ok": false,
		  "reason": "command_failed",
		  "target": "/busybee-failure/workflow.ts",
		}
	`);
	expect(await beads.list(scope, selection)).toEqual(before);
});
