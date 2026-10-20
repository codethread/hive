/* eslint-disable unicorn/no-null -- Persisted workflow contracts use null request IDs. */
import type { ActiveEntry, Run } from "../../src/checkpoint.ts";
import { assign, createMachine, initialTransition, raise, setup } from "xstate";
import { expect, test } from "bun:test";
import {
	commandSchemas as landCommandSchemas,
	inputSchema as landInputSchema,
	machine as landMachine,
} from "../../../../.workflows/land/workflow.ts";
import { workflowInspectionSchema, workflowSimulationSchema } from "@hive/shared";
import type { Definition } from "../../src/definition.ts";
import type { WorkflowSimulationRequest } from "@hive/shared";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { z } from "zod";

const SUCCESS = 0;
const FAILURE = 1;
const FIRST = 0;
const START_COUNT = 2;
const INCREMENT = 3;
const RESULT_COUNT = 5;
const ONE = 1;
const repo = "/simulation";
const db = "/tracker/beads.db";
const args = ["--repo", repo, "--db", db];
const input = { count: START_COUNT, secret: "private-secret" };
const payload = z.object({ amount: z.number().positive() });
const step = { node: "flow.work", command: "advance", data: { amount: INCREMENT } };

// eslint-disable-next-line max-statements -- One public replay contract proves context, rollback and no publication.
test("simulation replays guards and assigns with rendered instructions and no saved changes #test-315", async () => {
	const fixture = await simulationFixture();
	const before = await fixture.records();
	const initial = await fixture.simulate([]);
	expect(initial.actor.instructions["flow.work"]).toMatchObject({
		kind: "frozen",
		instructions: "Frozen published instructions",
	});
	const next = await fixture.simulate([step]);
	expect(next.actor.snapshot).toEqual({ status: "active", value: "review" });
	expect(next.actor.instructions["flow.review"]).toMatchObject({
		kind: "rendered",
		instructions: `Count ${String(RESULT_COUNT)}`,
	});
	expect(next.choices).toMatchObject([{ node: "flow.review", command: "finish", event: "DONE" }]);
	expect(JSON.stringify(next)).not.toContain("private-secret");
	expect(JSON.stringify(next)).not.toContain("context");
	expect(await fixture.simulate([])).toEqual(initial);
	const fromStart = await fixture.simulate([], {
		kind: "initial",
		input: { count: 1, secret: "new" },
	});
	expect(fromStart.actor.instructions["flow.work"]).toMatchObject({
		kind: "rendered",
		instructions: "Count 1",
	});
	const done = await fixture.simulate([step, { node: "flow.review", command: "finish", data: {} }]);
	expect(done.actor.snapshot.status).toBe("done");
	expect(done.choices).toEqual([]);
	expect(await fixture.records()).toEqual(before);
	const inspection = await fixture.inspect();
	expect(inspection.actors[FIRST]!.instructions["flow.work"]).toMatchObject({
		kind: "frozen",
		instructions: "Frozen published instructions",
	});
});

// eslint-disable-next-line max-statements -- Verify supported routing and rejected effects together.
test("simulation supports internal raises and rejects effects only when entered #test-321", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { advance: z.object({}), fail: z.object({}) };
	definition.machine = createMachine({
		id: "flow",
		initial: "work",
		context: input,
		states: {
			work: { meta: taskMeta({ advance: "NEXT" }), on: { NEXT: "route" } },
			route: { entry: raise({ type: "ROUTED" }), on: { ROUTED: "review" } },
			review: { meta: taskMeta({ fail: "FAIL" }), on: { FAIL: "effect" } },
			effect: { entry: forbidden },
			timer: { after: { 10: "review" } },
		},
	});
	const fixture = await simulationFixture(definition);
	const before = await fixture.records();
	const events = [{ node: "flow.work", command: "advance", data: {} }];
	const result = await fixture.simulate(events);
	expect(result.actor.snapshot.value).toBe("review");
	const rejected = await fixture.raw({
		...fixture.request,
		events: [...events, { node: "flow.review", command: "fail", data: {} }],
	});
	expect(JSON.parse(rejected.stdout)).toMatchObject({ reason: "simulation_unsupported", step: 1 });
	expect(await fixture.records()).toEqual(before);
});

test.each(["settled parent", "transient renderer"])(
	"simulation renders new visits at the settled frontier (%s) #test-319",
	// eslint-disable-next-line max-statements -- Verify settled briefs and native immutability through one replay.
	async (kind) => {
		const definition = exampleDefinition();
		definition.commandSchemas = { advance: z.object({}) };
		const route = { always: { target: "work", actions: assign({ count: RESULT_COUNT }) } };
		let transient = {};
		if (kind === "transient renderer") {
			transient = { meta: { title: "Transient", task: forbidden } };
		}
		definition.machine = createMachine({
			id: "flow",
			initial: "work",
			context: input,
			states: {
				work: { meta: taskMeta({ advance: "NEXT" }), on: { NEXT: "review" } },
				review: {
					meta: taskMeta({}),
					initial: "route",
					states: {
						route: { ...route, ...transient },
						work: { meta: taskMeta({}) },
					},
				},
			},
		});
		const fixture = await simulationFixture(definition);
		const before = await fixture.records();
		const result = await fixture.simulate([{ node: "flow.work", command: "advance", data: {} }]);
		expect(result.actor.snapshot.value).toEqual({ review: "work" });
		expect(result.actor.instructions["flow.review"]).toMatchObject({
			kind: "rendered",
			instructions: `Count ${String(RESULT_COUNT)}`,
		});
		expect(result.actor.instructions["flow.review.work"]).toMatchObject({
			kind: "rendered",
			instructions: `Count ${String(RESULT_COUNT)}`,
		});
		expect(await fixture.records()).toEqual(before);
	},
);

test(
	"simulation preserves an untouched published parallel visit across transient exit " +
		"and re-entry #test-323",
	async () => {
		const definition = exampleDefinition();
		definition.commandSchemas = { advance: z.object({}), finish: z.object({}) };
		definition.machine = createMachine({
			id: "flow",
			initial: "work",
			context: input,
			states: {
				work: {
					type: "parallel",
					states: {
						left: {
							initial: "work",
							states: {
								work: { meta: taskMeta({ advance: "NEXT" }), on: { NEXT: "#flow.route" } },
							},
						},
						right: { initial: "work", states: { work: { meta: taskMeta({ finish: "RIGHT" }) } } },
					},
				},
				route: { always: { target: "work", actions: assign({ count: RESULT_COUNT }) } },
			},
		});
		const fixture = await simulationFixture(definition, input, {
			published: {
				node: "flow.work.right.work",
				commands: { finish: "RIGHT" },
			},
		});
		const before = await fixture.records();
		const result = await fixture.simulate([
			{ node: "flow.work.left.work", command: "advance", data: {} },
		]);
		expect(result.actor.instructions["flow.work.right.work"]).toMatchObject({
			kind: "frozen",
			bead: fixture.visit,
			instructions: "Frozen published instructions",
		});
		expect(result.actor.instructions["flow.work.left.work"]).toMatchObject({
			kind: "rendered",
			instructions: `Count ${String(RESULT_COUNT)}`,
		});
		expect(result.choices).toMatchObject([
			{ node: "flow.work.right.work", command: "finish" },
			{ node: "flow.work.left.work", command: "advance" },
		]);
		expect(await fixture.records()).toEqual(before);
	},
);

// eslint-disable-next-line max-statements -- Compare independent saved and initial origins without publication.
test("an unsupported saved origin can still replay a supported explicit initial prefix #test-381", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { advance: z.object({}) };
	definition.machine = createMachine({
		id: "flow",
		initial: "work",
		context: input,
		states: {
			work: { meta: taskMeta({ advance: "NEXT" }), on: { NEXT: "timer" } },
			timer: { after: { 10: "done" } },
			done: { type: "final" },
		},
	});
	const saved = definition.machine.getPersistedSnapshot(
		definition.machine.resolveState({ value: "timer", context: input }),
	);
	const fixture = await simulationFixture(definition, input, { snapshot: saved });
	const before = await fixture.records();
	const blocked = await fixture.raw(fixture.request);
	expect(JSON.parse(blocked.stdout)).toMatchObject({ reason: "simulation_unsupported" });
	const initial = await fixture.simulate([], { kind: "initial", input });
	expect(initial.actor.snapshot.value).toBe("work");
	expect(initial.choices).toMatchObject([{ node: "flow.work", command: "advance" }]);
	expect(await fixture.records()).toEqual(before);
});

test.each([
	{ events: [{ ...step, data: { amount: "wrong" } }], reason: "simulation_invalid_payload" },
	{ events: [{ ...step, data: { amount: 1 } }], reason: "simulation_event_blocked" },
	{ events: [{ ...step, node: "flow.review" }], reason: "simulation_command_unavailable" },
])(
	"simulation rejects $reason with step identity and no native effects #test-382",
	async ({ events, reason }) => {
		const fixture = await simulationFixture();
		const before = await fixture.records();
		const result = await fixture.raw({ ...fixture.request, events });
		expect(result.code).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			kind: "workflow_simulation",
			reason,
			step: FIRST,
		});
		expect(result.stderr).toBe("");
		expect(await fixture.records()).toEqual(before);
	},
);

test.each(["checkpoint", "savedAt", "definitionHash"] as const)(
	"simulation rejects stale %s #test-401",
	async (field) => {
		const fixture = await simulationFixture();
		const result = await fixture.raw({ ...fixture.request, [field]: "stale" });
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			reason: "simulation_stale_baseline",
		});
	},
);

test("simulation enforces explicit JSON fields and input schema at the public CLI boundary #test-316", async () => {
	const fixture = await simulationFixture();
	for (const request of [
		{ ...fixture.request, start: { kind: "initial" } },
		{ ...fixture.request, events: [{ node: "flow.work", command: "advance" }] },
		{ ...fixture.request, start: { kind: "initial", input: {} } },
	]) {
		// eslint-disable-next-line no-await-in-loop -- Requests independently exercise the same boundary.
		const result = await fixture.raw(request);
		expect(result.code).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, reason: "invalid_input" });
	}
	const schema = await captureCli(["system", "schema", "--simulation", "--json"], createServices());
	expect(schema.code).toBe(SUCCESS);
	expect(JSON.parse(schema.stdout)).toMatchObject({
		kind: "workflow_simulation_schema",
		requestSchema: { required: expect.arrayContaining(["events", "start"]) },
		schema: { properties: { kind: { const: "workflow_simulation" } } },
	});
});

test("simulation uses real entry validation once and rejects new virtual visit validation #test-317", async () => {
	const calls: string[] = [];
	const definition = exampleDefinition();
	definition.validateCommand = (entry) => {
		calls.push(entry.bead);
	};
	const fixture = await simulationFixture(definition);
	await fixture.simulate([step]);
	expect(calls).toEqual([fixture.visit]);
	const result = await fixture.raw({
		...fixture.request,
		events: [step, { node: "flow.review", command: "finish", data: {} }],
	});
	expect(JSON.parse(result.stdout)).toMatchObject({ reason: "simulation_unsupported", step: 1 });
	expect(calls).toEqual([fixture.visit, fixture.visit]);
});

test("real Land root replay carries simulated evidence through authored routing #test-318", async () => {
	const landInput = {
		beadsDb: db,
		canonicalRoot: repo,
		completedTasks: [],
		request: "Land this example",
		target: { kind: "worktree", branch: "example" },
	};
	const fixture = await simulationFixture(
		{
			machine: landMachine,
			inputSchema: landInputSchema,
			commandSchemas: landCommandSchemas,
			runBrief: forbidden,
		},
		landInput,
	);
	const result = await fixture.simulate([
		{ node: "land.check", command: "passed", data: { evidence: "SIMULATED review evidence" } },
	]);
	expect(result.actor.snapshot.value).toBe("review");
	expect(result.actor.instructions["land.review"]).toMatchObject({
		kind: "rendered",
		instructions: expect.stringContaining("SIMULATED review evidence"),
	});
	expect(result.choices).toMatchObject([
		{ node: "land.review", command: "approved" },
		{ command: "changes" },
	]);
	const initial = await fixture.simulate([], { kind: "initial", input: landInput });
	expect(initial.actor.snapshot.value).toBe("check");
});

// eslint-disable-next-line max-statements -- Exercise the complete parallel replay path at the CLI boundary.
test("parallel commands with the same name remain identified by their state node #test-320", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { next: z.object({}) };
	definition.machine = createMachine({
		id: "flow",
		initial: "work",
		context: input,
		states: {
			work: {
				type: "parallel",
				onDone: "done",
				states: {
					left: {
						initial: "work",
						states: {
							work: { meta: taskMeta({ next: "LEFT" }), on: { LEFT: "done" } },
							done: { type: "final" },
						},
					},
					right: {
						initial: "work",
						states: {
							work: { meta: taskMeta({ next: "RIGHT" }), on: { RIGHT: "done" } },
							done: { type: "final" },
						},
					},
				},
			},
			done: { type: "final" },
		},
	});
	const fixture = await simulationFixture(definition);
	const start: WorkflowSimulationRequest["start"] = { kind: "initial", input };
	const left = { node: "flow.work.left.work", command: "next", data: {} };
	const right = { node: "flow.work.right.work", command: "next", data: {} };
	const initial = await fixture.simulate([], start);
	expect(initial.choices.map(({ node, command, event }) => ({ node, command, event }))).toEqual([
		{ node: left.node, command: "next", event: "LEFT" },
		{ node: right.node, command: "next", event: "RIGHT" },
	]);
	const next = await fixture.simulate([left], start);
	expect(next.choices.map(({ node }) => node)).toEqual([right.node]);
	const done = await fixture.simulate([left, right], start);
	expect(done.actor.snapshot.status).toBe("done");
});

test("saved history resolves retained node references and stopped status stays stopped #test-411", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { next: z.object({}) };
	definition.machine = createMachine({
		id: "flow",
		initial: "work",
		context: input,
		states: {
			work: {
				initial: "first",
				states: {
					first: {},
					second: { meta: taskMeta({}) },
					history: { type: "history", history: "deep" },
				},
			},
			away: { meta: taskMeta({ next: "RETURN" }), on: { RETURN: "work.history" } },
		},
	});
	const saved = {
		...definition.machine.getPersistedSnapshot(
			definition.machine.resolveState({ value: "away", context: input }),
		),
		historyValue: { "flow.work.history": [{ id: "flow.work.second" }] },
	};
	const fixture = await simulationFixture(definition, input, { snapshot: saved });
	const next = await fixture.simulate([{ node: "flow.away", command: "next", data: {} }]);
	expect(next.actor.snapshot.value).toEqual({ work: "second" });
	const stopped = await simulationFixture(definition, input, {
		snapshot: {
			...saved,
			status: "stopped",
			output: undefined,
			error: undefined,
		},
	});
	const stoppedResult = await stopped.simulate([]);
	expect(stoppedResult.actor.snapshot.status).toBe("stopped");
});

// eslint-disable-next-line max-statements -- Verify child context isolation and completion in one endpoint fixture.
test("retained child replay uses its own context and never sends completion to its parent #test-314", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { next: z.object({}) };
	const child = createMachine({
		id: "child",
		initial: "work",
		states: {
			work: { meta: taskMeta({ next: "NEXT" }), on: { NEXT: "done" } },
			done: { type: "final" },
		},
	});
	definition.machine = createMachine({
		id: "parent",
		initial: "work",
		states: {
			work: { invoke: { id: "worker", src: child } },
		},
	});
	const childSaved = child.getPersistedSnapshot(
		child.resolveState({ value: "work", context: { count: RESULT_COUNT } }),
	);
	const saved = {
		...fixtureSnapshot(definition, input),
		children: { worker: { src: "xstate.invoke.0.parent.work", snapshot: childSaved } },
	};
	const fixture = await simulationFixture(definition, input, { snapshot: saved });
	const request = { ...fixture.request, actorId: 'actor:["worker"]' };
	const result = await fixture.raw(request);
	expect(result.code, result.stdout).toBe(SUCCESS);
	const simulation = workflowSimulationSchema.parse(JSON.parse(result.stdout));
	expect(simulation.actor).toMatchObject({
		path: ["worker"],
		instructions: {
			"child.work": { kind: "rendered", instructions: `Count ${String(RESULT_COUNT)}` },
		},
	});
	const complete = await fixture.raw({
		...request,
		events: [{ node: "child.work", command: "next", data: {} }],
	});
	expect(workflowSimulationSchema.parse(JSON.parse(complete.stdout)).actor.snapshot.status).toBe(
		"done",
	);
	const initial = await fixture.raw({ ...request, start: { kind: "initial", input: {} } });
	expect(JSON.parse(initial.stdout)).toMatchObject({ reason: "simulation_unsupported" });
});

test.each(["custom", "nested timer", "invocation", "assign spawn"])(
	"simulation rejects %s without executing effects #test-322",
	async (kind) => {
		let effects = FIRST;
		const effect = () => {
			effects += ONE;
		};
		const definition = unsupportedDefinition(kind, effect);
		const fixture = await simulationFixture(definition);
		const before = await fixture.records();
		const result = await fixture.raw({
			...fixture.request,
			events: [{ node: "unsupported.work", command: "next", data: {} }],
		});
		expect(result.code, result.stdout).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			reason: "simulation_unsupported",
		});
		expect(effects).toBe(FIRST);
		expect(await fixture.records()).toEqual(before);
	},
);

// --- Private fixtures ---

function exampleDefinition(): Definition {
	return {
		inputSchema: z.object({ count: z.number(), secret: z.string() }),
		commandSchemas: { advance: payload, choose: payload, finish: z.object({}) },
		runBrief: forbidden,
		machine: setup({
			types: {} as {
				context: typeof input;
				input: typeof input;
				events: { type: "NEXT" | "DONE"; data: unknown };
			},
			actions: {
				add: assign(({ context, event }) => ({
					count: context.count + payload.parse(event.data).amount,
				})),
			},
		}).createMachine({
			id: "flow",
			context: ({ input: initial }) => initial,
			initial: "work",
			states: {
				work: {
					meta: taskMeta({ choose: "NEXT" }),
					on: {
						NEXT: {
							guard: ({ event }) => payload.parse(event.data).amount > START_COUNT,
							actions: "add",
							target: "route",
						},
					},
				},
				route: {
					always: [
						{ guard: ({ context }) => context.count > START_COUNT, target: "review" },
						{ target: "work" },
					],
				},
				review: { meta: taskMeta({ finish: "DONE" }), on: { DONE: "done" } },
				done: { type: "final" },
			},
		}),
	};
}

function taskMeta(commands: Record<string, string>) {
	return {
		title: "Work",
		commands,
		task: ({ context }: { context: Record<string, unknown> }) => ({
			instructions: `Count ${String(context["count"])}`,
		}),
	};
}

// eslint-disable-next-line max-statements -- Keep unsupported chart variants together in one fixture.
function unsupportedDefinition(kind: string, effect: () => void): Definition {
	const definition = exampleDefinition();
	definition.commandSchemas["next"] = z.object({});
	let actions: unknown = effect;
	if (kind === "assign spawn") {
		actions = assign(({ spawn }) => ({ worker: spawn(createMachine({ entry: effect })) }));
	}
	const work = { meta: taskMeta({ next: "NEXT" }), on: { NEXT: { target: "done", actions } } };
	let states: unknown = { work, done: { type: "final" } };
	if (kind === "nested timer") {
		states = {
			work: {
				...work,
				initial: "nested",
				states: { nested: { after: { 10: { actions: effect } } } },
			},
			done: { type: "final" },
		};
	} else if (kind === "invocation") {
		states = {
			work: { ...work, invoke: { src: createMachine({ entry: effect }) } },
			done: { type: "final" },
		};
	}
	definition.machine = createMachine({ id: "unsupported", initial: "work", states } as Parameters<
		typeof createMachine
	>[typeof FIRST]);
	return definition;
}

// eslint-disable-next-line max-statements -- Seed the public read-only endpoint without runtime actor startup.
async function simulationFixture(
	definition = exampleDefinition(),
	initialInput: unknown = input,
	options: {
		snapshot?: Run["snapshot"];
		published?: { node: string; commands: Record<string, string> };
	} = {},
) {
	const { snapshot: savedSnapshot, published } = options;
	const beads = createMemoryBeads({ db });
	const scope = { db, cwd: repo, actor: "fixture" };
	const parent = await beads.create(scope, { title: "Run", owner: "ct" });
	const visit = await beads.create(scope, { title: "Published", owner: "ct", parent: parent.id });
	const snapshot = savedSnapshot ?? fixtureSnapshot(definition, initialInput);
	const saved: Run = {
		formatVersion: 1,
		id: parent.id,
		hash: "saved-hash",
		definition: { kind: "named", name: "example", version: "1.0.0" },
		snapshot,
		created: [],
		history: [],
		visits: {},
		active: fixtureEntries(definition, visit.id).map((entry) => {
			if (published !== undefined) {
				Object.assign(entry, { node: published.node, key: `:${published.node}` });
				entry.meta.commands = published.commands;
			}
			return entry;
		}),
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
	const inspect = async () => {
		const result = await captureCli([...args, "system", "preview", parent.id, "--json"], services);
		expect(result.code, result.stdout).toBe(SUCCESS);
		return workflowInspectionSchema.parse(JSON.parse(result.stdout));
	};
	const baseline = await inspect();
	const request: WorkflowSimulationRequest = {
		checkpoint: baseline.checkpoint,
		savedAt: baseline.savedAt,
		definitionHash: baseline.definition.currentHash,
		actorId: "actor:[]",
		start: { kind: "saved" },
		events: [],
	};
	const raw = async (body: unknown) =>
		await captureCli(
			[...args, "system", "simulate", parent.id, "--request", JSON.stringify(body), "--json"],
			services,
		);
	return {
		request,
		inspect,
		raw,
		visit: visit.id,
		records: async () => await beads.showMany(scope, [parent.id, visit.id, checkpoint.id]),
		simulate: async (events: WorkflowSimulationRequest["events"], start = request.start) => {
			const result = await raw({ ...request, start, events });
			expect(result.code, result.stdout).toBe(SUCCESS);
			expect(result.stderr).toBe("");
			return workflowSimulationSchema.parse(JSON.parse(result.stdout));
		},
	};
}

function fixtureSnapshot(definition: Definition, initialInput: unknown): Run["snapshot"] {
	if (definition.machine === landMachine) {
		return definition.machine.getPersistedSnapshot(
			initialTransition(definition.machine, initialInput)[FIRST],
		);
	}
	return definition.machine.getPersistedSnapshot(
		definition.machine.resolveState({ value: "work", context: input }),
	);
}

function fixtureEntries(definition: Definition, bead: string): ActiveEntry[] {
	if (definition.machine === landMachine) {
		return [];
	}
	let node = "flow.work";
	let commands = { advance: "NEXT" } as Record<string, string>;
	if (definition.machine.id !== "flow") {
		node = "unsupported.work";
		commands = { next: "NEXT" };
	}
	return [
		{
			bead,
			key: `:${node}`,
			path: [],
			node,
			request: null,
			context: input,
			meta: { title: "Published", instructions: "Frozen published instructions", commands },
		},
	];
}

function forbidden(): never {
	throw new Error("Simulation must not invoke this operation");
}
