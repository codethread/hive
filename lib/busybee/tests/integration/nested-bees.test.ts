import { expect, test } from "bun:test";
import { setup } from "xstate";
import { startNestedBees } from "./nested-bees-fixture.ts";
import { z } from "zod";

const FIRST = 0;
const DISPATCHES = 4;
const ACTORS = 3;
const FAILURE = 1;
const STAGE_PREFIX_LENGTH = 4;

// eslint-disable-next-line max-statements -- Verify dispatch, hierarchy and closure of one authored run.
test("nested Bee authoring publishes grouped child visits and independent dispatch requests", async () => {
	const fixture = await startNestedBees(nestedFixture());
	const completion = await fixture.finish();
	const { originalVisits, calls, started } = fixture;
	expect(started.actors).toHaveLength(ACTORS);
	for (const path of ["api", "interface"]) {
		const group = originalVisits.find((entry) => entry.node === `nested-bees.team.${path}`)!;
		const visit = originalVisits.find((entry) => entry.path[FIRST] === path)!;
		expect(visit.parent).toBe(group.bead);
		expect(visit.request).toBeString();
		expect(
			started.actors.find((actor) => actor.path[FIRST] === path)!.instructions[
				"nested-worker.implement"
			],
		).toMatchObject({
			kind: "frozen",
			bead: visit.bead,
			bee: { kind: "worker", request: visit.request },
		});
	}
	expect(calls).toHaveLength(DISPATCHES);
	expect(calls.map((call) => call.slice(FIRST, STAGE_PREFIX_LENGTH))).toEqual([
		["bee", "system", "dispatch-stage", "worker"],
		["bee", "system", "dispatch-stage", "worker"],
		["bee", "system", "dispatch-stage", "reviewer"],
		["bee", "system", "dispatch-stage", "reviewer"],
	]);
	expect(completion.finalRun.status).toBe("done");
	expect(completion.parent.status).toBe("open");
	for (const visit of completion.finalRun.created) {
		expect(completion.records.find((record) => record.id === visit.bead)!.status).toBe("closed");
	}
});

// eslint-disable-next-line max-statements -- Compare saved and simulated identity across both child frontiers.
test("saved public projections distinguish branch stages and isolated child simulation", async () => {
	const fixture = await startNestedBees(nestedFixture());
	const simulation = await fixture.simulate();
	const { mixed, unsupported, childSaved, childSimulation, interfaceSimulation } =
		simulation.captured;
	expect(mixed.actors.map(({ path, snapshot }) => ({ path, snapshot }))).toEqual([
		{
			path: [],
			snapshot: { value: { team: { api: "working", interface: "working" } }, status: "active" },
		},
		{ path: ["api"], snapshot: { value: "verify", status: "active" } },
		{ path: ["interface"], snapshot: { value: "implement", status: "active" } },
	]);
	expect(simulation.unsupportedCode).toBe(FAILURE);
	expect(unsupported).toMatchObject({ ok: false, reason: "simulation_unsupported" });
	expect(childSaved.actor.instructions["nested-worker.verify"]).toMatchObject({
		kind: "frozen",
		bee: { kind: "reviewer" },
	});
	expect(childSimulation.actor.snapshot).toEqual({ value: "done", status: "done" });
	expect(interfaceSimulation.actor.instructions["nested-worker.verify"]).toMatchObject({
		kind: "rendered",
		bee: { kind: "reviewer" },
	});
	expect(interfaceSimulation.actor.instructions["nested-worker.verify"]).not.toHaveProperty("bead");
	expect(interfaceSimulation.actor.instructions["nested-worker.verify"]).not.toHaveProperty(
		"bee.request",
	);
	expect(fixture.afterInspection).toEqual(fixture.beforeInspection);
	expect(simulation.afterSimulation).toEqual(simulation.beforeSimulation);
});

function nestedFixture() {
	const source = "/nested-bees-fixture/workflow.ts";
	const bytes = new TextEncoder().encode("nested engine fixture").buffer;
	return {
		definition: nestedDefinition(),
		source,
		files: {
			isFile: (path: string) => Promise.resolve(path === source),
			readBytes: (path: string) => {
				if (path !== source) {
					throw new Error(`Unexpected fixture source: ${path}`);
				}
				return Promise.resolve(bytes);
			},
		},
	};
}

function nestedDefinition() {
	const worker = setup({
		types: {} as { context: { group: string }; input: { group: string } },
	}).createMachine({
		id: "nested-worker",
		context: ({ input }) => input,
		initial: "implement",
		states: {
			implement: {
				meta: {
					title: "First",
					commands: { next: "NEXT" },
					task: () => ({ instructions: "First", bee: { kind: "worker" } }),
				},
				on: { NEXT: "verify" },
			},
			verify: {
				meta: {
					title: "Second",
					commands: { next: "NEXT" },
					task: () => ({ instructions: "Second", bee: { kind: "reviewer" } }),
				},
				on: { NEXT: "done" },
			},
			done: { type: "final" },
		},
	});
	return {
		inputSchema: z.object({}),
		commandSchemas: { next: z.object({}) },
		runBrief: () => ({ title: "Nested fixture", description: "Exercise child dispatch" }),
		machine: setup({ actors: { worker } }).createMachine({
			id: "nested-bees",
			initial: "team",
			states: {
				team: {
					type: "parallel",
					onDone: "handoff",
					states: {
						api: {
							meta: { title: "Left", task: () => ({ instructions: "Left" }) },
							initial: "working",
							states: {
								working: {
									invoke: {
										id: "api",
										src: "worker",
										input: { group: "nested-bees.team.api" },
										onDone: "done",
									},
								},
								done: { type: "final" },
							},
						},
						interface: {
							meta: { title: "Right", task: () => ({ instructions: "Right" }) },
							initial: "working",
							states: {
								working: {
									invoke: {
										id: "interface",
										src: "worker",
										input: { group: "nested-bees.team.interface" },
										onDone: "done",
									},
								},
								done: { type: "final" },
							},
						},
					},
				},
				handoff: {
					meta: {
						title: "Join",
						commands: { next: "NEXT" },
						task: () => ({ instructions: "Join" }),
					},
					on: { NEXT: "done" },
				},
				done: { type: "final" },
			},
		}),
	};
}
