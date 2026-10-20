import { expect, test } from "bun:test";
import { captureNestedBees } from "./nested-bees-fixture.ts";

const FIRST = 0;
const DISPATCHES = 4;
const ACTORS = 3;
const FAILURE = 1;
const STAGE_PREFIX_LENGTH = 4;
const fixture = await captureNestedBees();

// eslint-disable-next-line max-statements -- Verify dispatch, hierarchy and closure of one authored run.
test("nested Bee authoring publishes grouped child visits and independent dispatch requests", () => {
	const { originalVisits, calls, captured } = fixture;
	expect(captured.started.actors).toHaveLength(ACTORS);
	for (const path of ["api", "interface"]) {
		const group = originalVisits.find((entry) => entry.node === `nested-bees.team.${path}`)!;
		const visit = originalVisits.find((entry) => entry.path[FIRST] === path)!;
		expect(visit.parent).toBe(group.bead);
		expect(visit.request).toBeString();
		expect(
			captured.started.actors.find((actor) => actor.path[FIRST] === path)!.instructions[
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
	expect(fixture.finalRun.status).toBe("done");
	expect(fixture.parent.status).toBe("open");
	for (const visit of fixture.finalRun.created) {
		expect(fixture.records.find((record) => record.id === visit.bead)!.status).toBe("closed");
	}
});

// eslint-disable-next-line max-statements -- Compare real and simulated identity across both child frontiers.
test("saved public projections distinguish branch stages and isolated child simulation", () => {
	const { mixed, unsupported, childSaved, childSimulation, interfaceSimulation } = fixture.captured;
	expect(mixed.actors.map(({ path, snapshot }) => ({ path, snapshot }))).toEqual([
		{
			path: [],
			snapshot: { value: { team: { api: "working", interface: "working" } }, status: "active" },
		},
		{ path: ["api"], snapshot: { value: "verify", status: "active" } },
		{ path: ["interface"], snapshot: { value: "implement", status: "active" } },
	]);
	expect(fixture.unsupportedCode).toBe(FAILURE);
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
	expect(fixture.afterSimulation).toEqual(fixture.beforeSimulation);
});

test("Storybook captures match the real authored runtime and public inspection path #test-443", async () => {
	const saved = await Bun.file(
		new URL("../../../hive-ui/src/stories/workflow-nested-bees.json", import.meta.url),
	).json();
	expect(fixture.captured).toEqual(saved);
});
