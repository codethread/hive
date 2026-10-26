/* eslint-disable import/max-dependencies */
/* eslint-disable unicorn/no-null -- Persisted workflow contracts use null request IDs. */
import type { ActiveEntry, Run } from "../../src/checkpoint.ts";
import { assign, createMachine, raise, sendParent, setup } from "xstate";
import { expect, test } from "bun:test";
import type { Definition } from "../../src/definition.ts";
import type { WorkflowSimulationRequest } from "@hive/shared";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { inspect } from "../../src/preview.ts";
import { simulate } from "../../src/simulation.ts";
import { workflowSimulationSchema } from "@hive/shared";
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
		bead: fixture.visit,
		bee: { kind: "worker", request: "published-request" },
		instructions: "Frozen published instructions",
	});
	const response = await fixture.raw({ ...fixture.request, events: [step] });
	expect(response).toMatchObject({ code: SUCCESS, stderr: "" });
	const next = workflowSimulationSchema.parse(JSON.parse(response.stdout));
	expect(next.actor.snapshot).toEqual({ status: "active", value: "review" });
	expect(next.actor.instructions["flow.review"]).toMatchObject({
		kind: "rendered",
		bee: { kind: "worker" },
		instructions: `Count ${String(RESULT_COUNT)}`,
	});
	expect(next.actor.instructions["flow.review"]).not.toHaveProperty("bead");
	expect(next.actor.instructions["flow.review"]).not.toHaveProperty("bee.request");
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
		bead: fixture.visit,
		bee: { kind: "worker", request: "published-request" },
		instructions: "Frozen published instructions",
	});
	expect(await fixture.records()).toEqual(before);
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

// eslint-disable-next-line max-statements
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
	const fixture = await simulationFixture(definition, { snapshot: saved });
	const next = await fixture.simulate([{ node: "flow.away", command: "next", data: {} }]);
	expect(next.actor.snapshot.value).toEqual({ work: "second" });
	const stopped = await simulationFixture(definition, {
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
		...fixtureSnapshot(definition),
		children: { worker: { src: "xstate.invoke.0.parent.work", snapshot: childSaved } },
	};
	const fixture = await simulationFixture(definition, { snapshot: saved });
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

test.each([
	{ origin: "saved", command: "advance", expectedStep: ONE },
	{ origin: "initial", command: "choose", expectedStep: FIRST },
])(
	"simulation author validation requires a published visit ($origin start) #test-302",
	// eslint-disable-next-line max-statements -- Verify published validation and virtual-visit rejection in one replay.
	async ({ origin, command, expectedStep }) => {
		const definition = exampleDefinition();
		definition.validateCommand = (entry, _command, data) => {
			expect(entry.context).toEqual(input);
			return data;
		};
		const fixture = await simulationFixture(definition);
		const before = await fixture.records();
		const events: WorkflowSimulationRequest["events"] = [{ ...step, command }];
		let start: WorkflowSimulationRequest["start"] = { kind: "initial", input };
		if (origin === "saved") {
			start = { kind: "saved" };
			const next = await fixture.simulate(events);
			expect(next.actor.snapshot.value).toBe("review");
			events.push({ node: "flow.review", command: "finish", data: {} });
		}
		const result = await fixture.raw({
			...fixture.request,
			start,
			events,
		});
		expect(result.code).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({
			reason: "simulation_unsupported",
			step: expectedStep,
		});
		expect(await fixture.records()).toEqual(before);
	},
);

// eslint-disable-next-line max-statements -- Keep child validation, forbidden messaging and preservation together.
test("retained child validation precedes rejected parent messaging without saved changes #test-301", async () => {
	const definition = exampleDefinition();
	definition.commandSchemas = { next: payload };
	const child = createMachine({
		id: "child",
		initial: "work",
		states: {
			work: {
				meta: taskMeta({ next: "NEXT" }),
				on: { NEXT: { target: "done", actions: sendParent({ type: "CHILD_DONE" }) } },
			},
			done: { type: "final" },
		},
	});
	definition.machine = createMachine({
		id: "parent",
		initial: "work",
		states: {
			work: { invoke: { id: "worker", src: child }, on: { CHILD_DONE: "done" } },
			done: { type: "final" },
		},
	});
	definition.validateCommand = (entry, _command, data) => {
		if (payload.parse(data).amount !== entry.context["count"]) {
			throw new Error("Payload must match published child context");
		}
		return data;
	};
	const childContext = { count: RESULT_COUNT };
	const snapshot = {
		...fixtureSnapshot(definition),
		children: {
			worker: {
				src: "xstate.invoke.0.parent.work",
				snapshot: child.getPersistedSnapshot(
					child.resolveState({ value: "work", context: childContext }),
				),
			},
		},
	};
	const fixture = await simulationFixture(definition, {
		snapshot,
		published: {
			node: "child.work",
			path: ["worker"],
			context: childContext,
			commands: { next: "NEXT" },
		},
	});
	const before = await fixture.records();
	const request = { ...fixture.request, actorId: 'actor:["worker"]' };
	const initial = await fixture.raw(request);
	expect(initial.code).toBe(SUCCESS);
	expect(
		workflowSimulationSchema.parse(JSON.parse(initial.stdout)).actor.instructions["child.work"],
	).toMatchObject({ kind: "frozen" });
	for (const { amount, reason } of [
		{ amount: INCREMENT, reason: "simulation_invalid_event" },
		{ amount: RESULT_COUNT, reason: "simulation_unsupported" },
	]) {
		// eslint-disable-next-line no-await-in-loop -- Verify author rejection before the messaging boundary.
		const result = await fixture.raw({
			...request,
			events: [{ node: "child.work", command: "next", data: { amount } }],
		});
		expect(result.code).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({
			reason,
			step: FIRST,
			node: "child.work",
			command: "next",
		});
		expect(JSON.parse(result.stdout)).not.toHaveProperty("actor");
	}
	expect(await fixture.raw(request)).toEqual(initial);
	expect(await fixture.records()).toEqual(before);
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
			bee: { kind: "worker" },
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
	options: {
		snapshot?: Run["snapshot"];
		published?: {
			node: string;
			path: string[];
			context: Record<string, unknown>;
			commands: Record<string, string>;
		};
	} = {},
) {
	const { snapshot: savedSnapshot, published } = options;
	const beads = createMemoryBeads({ db });
	const scope = { db, cwd: repo, actor: "fixture" };
	const parent = await beads.create(scope, { title: "Run", owner: "ct" });
	const visit = await beads.create(scope, { title: "Published", owner: "ct", parent: parent.id });
	const snapshot = savedSnapshot ?? fixtureSnapshot(definition);
	const saved: Run = {
		formatVersion: 2,
		lock: null,
		managedExecution: "unmanaged",
		results: {},
		completions: {},
		settlement: null,
		id: parent.id,
		hash: "saved-hash",
		definition: { kind: "named", name: "example", version: "1.0.0" },
		snapshot,
		created: [],
		history: [],
		visits: {},
		active: fixtureEntries(definition, visit.id).map((entry) => {
			if (published !== undefined) {
				Object.assign(entry, {
					node: published.node,
					key: `${published.path.join(":")}:${published.node}`,
					path: published.path,
					context: published.context,
				});
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
	const inspection = () => inspect(parent.id, { repo, db }, services);
	const baseline = await inspection();
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
		inspect: inspection,
		raw,
		visit: visit.id,
		records: async () => await beads.showMany(scope, [parent.id, visit.id, checkpoint.id]),
		simulate: (events: WorkflowSimulationRequest["events"], start = request.start) =>
			simulate({ id: parent.id, request: { ...request, start, events } }, { repo, db }, services),
	};
}

function fixtureSnapshot(definition: Definition): Run["snapshot"] {
	return definition.machine.getPersistedSnapshot(
		definition.machine.resolveState({ value: "work", context: input }),
	);
}

function fixtureEntries(definition: Definition, bead: string): ActiveEntry[] {
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
			request: "published-request",
			context: input,
			meta: {
				title: "Published",
				instructions: "Frozen published instructions",
				commands,
				bee: { kind: "worker" },
			},
		},
	];
}

function forbidden(): never {
	throw new Error("Simulation must not invoke this operation");
}
