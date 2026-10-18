/* eslint-disable unicorn/no-null -- Persisted workflow contracts use null request IDs. */
/* eslint-disable import/max-dependencies -- Exercise four shipped definitions through the shared CLI harness. */
/* eslint-disable typescript/prefer-readonly-parameter-types -- Use shared mutable XState and CLI fixture types. */

import type { ActiveEntry, Run } from "../../src/checkpoint.ts";
import type { WorkflowSimulation, WorkflowSimulationRequest } from "@hive/shared";
import {
	commandSchemas as changeReviewCommandSchemas,
	inputSchema as changeReviewInputSchema,
	machine as changeReviewMachine,
	reviewer as changeReviewReviewer,
	validateCommand as changeReviewValidateCommand,
} from "../../examples/change-review/workflow.ts";
import { expect, test } from "bun:test";
import {
	commandSchemas as groceriesCommandSchemas,
	inputSchema as groceriesInputSchema,
	machine as groceriesMachine,
} from "../../examples/groceries/workflow.ts";
import {
	commandSchemas as linearCommandSchemas,
	inputSchema as linearInputSchema,
	machine as linearMachine,
} from "../../examples/bee-driver/linear.ts";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import {
	commandSchemas as parallelCommandSchemas,
	inputSchema as parallelInputSchema,
	machine as parallelMachine,
} from "../../examples/parallel/workflow.ts";
import { workflowInspectionSchema, workflowSimulationSchema } from "@hive/shared";
import type { Definition } from "../../src/definition.ts";
import { captureCli } from "./support.ts";
import { createMemoryBeads } from "@hive/beads";
import { createServices } from "../../src/native.ts";
import { initialTransition } from "xstate";
import { z } from "zod";

const changeReview = {
	machine: changeReviewMachine,
	inputSchema: changeReviewInputSchema,
	commandSchemas: changeReviewCommandSchemas,
	runBrief: forbidden,
	validateCommand: changeReviewValidateCommand,
};
const groceries = {
	machine: groceriesMachine,
	inputSchema: groceriesInputSchema,
	commandSchemas: groceriesCommandSchemas,
	runBrief: forbidden,
};
const linear = {
	machine: linearMachine,
	inputSchema: linearInputSchema,
	commandSchemas: linearCommandSchemas,
	runBrief: forbidden,
};
const parallel = {
	machine: parallelMachine,
	inputSchema: parallelInputSchema,
	commandSchemas: parallelCommandSchemas,
	runBrief: forbidden,
};
const SUCCESS = 0;
const FAILURE = 1;
const FIRST = 0;
const EMPTY = 0;
const SHA_LENGTH = 40;
const repo = "/simulation-examples";
const db = "/memory/beads.db";
const origins: Origin[] = ["saved", "initial"];
const linearInput = { request: "Exercise all three stages", worktree: "/work/example" };
const changeInput = {
	base: "a".repeat(SHA_LENGTH),
	execution: { mode: "driver-handled" as const },
	request: "Verify simulation isolation",
	title: "Simulation example",
};
const reviewTask = {
	checks: ["bun test simulation-examples.test.ts"],
	files: ["simulation-examples.test.ts"],
	id: "simulation",
	instructions: "Inspect the public simulation boundary without editing files.",
	title: "Review simulation isolation",
};
const plan = {
	choice: "planned",
	revision: "example-revision",
	summary: "Review the simulation example",
	tasks: [reviewTask],
};
const reviewerInput = {
	...changeInput,
	group: "change-review.review",
	revision: plan.revision,
	round: 1,
	task: reviewTask,
};
const approval = {
	choice: "approved",
	evidence: ["Inspected memory-only CLI fixture"],
	findings: [],
	revision: plan.revision,
};
type Event = WorkflowSimulationRequest["events"][number];
type Origin = "saved" | "initial";
interface PublishedVisit {
	/** Real retained visit used for author validation. */
	node: string;
	/** Retained actor owning the visit. */
	path: string[];
	/** Published private context supplied to validation and rendering. */
	context: Record<string, unknown>;
}

// eslint-disable-next-line max-statements -- Follow both regions, the revision loop and the join in one replay.
test.each(origins)("shipped parallel example joins both regions from %s", async (origin) => {
	const fixture = await exampleFixture(parallel, {});
	const events = [event("parallel-work.prepare")];
	const initial = await fixture.simulate([], origin);
	expect(identities(initial)).toEqual([
		{ node: "parallel-work.prepare", command: "next", event: "PREPARED" },
	]);
	const branches = await fixture.simulate(events, origin);
	expect(identities(branches)).toEqual([
		{
			node: "parallel-work.implementation.api.implement",
			command: "next",
			event: "API.IMPLEMENTED",
		},
		{ node: "parallel-work.implementation.docs.write", command: "next", event: "DOCS.WRITTEN" },
	]);
	events.push(
		event("parallel-work.implementation.docs.write"),
		event("parallel-work.implementation.docs.check", "revise"),
	);
	const revised = await fixture.simulate(events, origin);
	expect(revised.actor.snapshot.value).toEqual({
		implementation: { api: "implement", docs: "write" },
	});
	events.push(
		event("parallel-work.implementation.api.implement"),
		event("parallel-work.implementation.api.verify"),
	);
	const waiting = await fixture.simulate(events, origin);
	expect(identities(waiting)).toEqual([
		{ node: "parallel-work.implementation.docs.write", command: "next", event: "DOCS.WRITTEN" },
	]);
	events.push(
		event("parallel-work.implementation.docs.write"),
		event("parallel-work.implementation.docs.check", "approved"),
	);
	const joined = await fixture.simulate(events, origin);
	expect(joined.actor.snapshot.value).toBe("handoff");
	expect(joined.actor.instructions["parallel-work.handoff"]).toMatchObject({
		kind: "rendered",
		instructions: "Summarize both completed branches.",
	});
	events.push(event("parallel-work.handoff"));
	const done = await fixture.simulate(events, origin);
	expect(done.actor.snapshot).toEqual({ status: "done", value: "done" });
	expect(done.choices).toEqual([]);
	await fixture.assertUnchanged();
});

// eslint-disable-next-line max-statements -- Exercise replanning, substitution and final guard together.
test.each(origins)("shipped groceries example replans and completes from %s", async (origin) => {
	const fixture = await exampleFixture(groceries, {});
	const events = [event("groceries.planning.calendar", "busy", { meals: 3 })];
	const busy = await fixture.simulate(events, origin);
	expect(busy.actor.snapshot.value).toEqual({ recipes: "quick" });
	expect(busy.actor.instructions["groceries.recipes.quick"]).toMatchObject({
		kind: "rendered",
	});
	expect(instructions(busy, "groceries.recipes.quick")).toContain("fit the busy evenings");
	events.push(...shoppingPath("quick"), event("groceries.shopping.build", "replan"));
	const replan = await fixture.simulate(events, origin);
	expect(replan.actor.snapshot.value).toEqual({ planning: "calendar" });
	events.push(event("groceries.planning.calendar", "flexible", { meals: 5 }));
	const flexible = await fixture.simulate(events, origin);
	expect(flexible.actor.snapshot.value).toEqual({ recipes: "seasonal" });
	events.push(
		...shoppingPath("seasonal"),
		event("groceries.shopping.build"),
		event("groceries.shopping.availability", "unavailable"),
	);
	const fallback = await fixture.simulate(events, origin);
	expect(fallback.actor.snapshot.value).toEqual({ shopping: "fallback" });
	expect(identities(fallback)).toContainEqual({
		node: "groceries.shopping.fallback",
		command: "substitute",
		event: "CHOICE.substitute",
	});
	events.push(
		event("groceries.shopping.fallback", "substitute"),
		event("groceries.shopping.availability", "available"),
		event("groceries.budget.check", "within-budget"),
		event("groceries.outputs.meal_plan"),
		event("groceries.outputs.grocery_list"),
	);
	const confirm = await fixture.simulate(events, origin);
	expect(confirm.actor.snapshot.value).toEqual({ outputs: "confirm" });
	expect(confirm.actor.instructions["groceries.outputs.confirm"]).toMatchObject({
		kind: "rendered",
	});
	expect(instructions(confirm, "groceries.outputs.confirm")).toContain("quantities match servings");
	events.push(event("groceries.outputs.confirm", "done"));
	const done = await fixture.simulate(events, origin);
	expect(done.actor.snapshot.status).toBe("done");
	expect(done.choices).toEqual([]);
	await fixture.assertUnchanged();
});

test.each([
	{ meals: 0, code: FAILURE },
	{ meals: 2, code: SUCCESS },
])("shipped groceries final guard respects saved meal count $meals", async ({ meals, code }) => {
	const snapshot = groceriesMachine.getPersistedSnapshot(
		groceriesMachine.resolveState({
			value: { outputs: "confirm" },
			context: { busyWeek: false, plannedMeals: meals, substitutions: 0 },
		}),
	);
	const fixture = await exampleFixture(groceries, {}, { snapshot });
	const result = await fixture.raw({
		...fixture.request,
		events: [event("groceries.outputs.confirm", "done")],
	});
	expect(result.code, result.stdout).toBe(code);
	if (code === FAILURE) {
		expect(JSON.parse(result.stdout)).toMatchObject({
			reason: "simulation_event_blocked",
			step: FIRST,
			node: "groceries.outputs.confirm",
			command: "done",
		});
	} else {
		expect(workflowSimulationSchema.parse(JSON.parse(result.stdout)).actor.snapshot.status).toBe(
			"done",
		);
	}
	await fixture.assertUnchanged();
});

test.each(origins)(
	"shipped linear example renders caller context through completion from %s",
	// eslint-disable-next-line max-statements -- Verify all three rendered stages and completion.
	async (origin) => {
		const fixture = await exampleFixture(linear, linearInput);
		const events: Event[] = [];
		for (const stage of ["A", "B", "C"]) {
			// eslint-disable-next-line no-await-in-loop -- Every replay verifies a consecutive stage frontier.
			const result = await fixture.simulate(events, origin);
			const node = `linear.stage${stage}`;
			expect(result.actor.instructions[node]).toEqual({
				kind: "rendered",
				title: stage,
				instructions: `Perform ${stage} for ${linearInput.request} in ${linearInput.worktree}.`,
			});
			expect(identities(result)).toEqual([{ node, command: "next", event: `${stage}.DONE` }]);
			events.push(event(node));
		}
		const done = await fixture.simulate(events, origin);
		expect(done.actor.snapshot).toEqual({ value: "done", status: "done" });
		expect(done.choices).toEqual([]);
		await fixture.assertUnchanged();
	},
);

test.each(origins)(
	"shipped change-review plan rejects spawning or virtual-visit validation from %s",
	// eslint-disable-next-line max-statements -- Distinguish saved spawn rejection from virtual visit validation.
	async (origin) => {
		const { context } = initialTransition(changeReviewMachine, changeInput)[FIRST];
		const fixture = await exampleFixture(changeReview, changeInput, {
			published: {
				node: "change-review.plan",
				path: [],
				context: { ...context },
			},
		});
		const initial = await fixture.simulate([], origin);
		let kind = "rendered";
		let detail = "real published task identity";
		if (origin === "saved") {
			kind = "frozen";
			detail = "Actor access through spawn";
		}
		expect(initial.actor.instructions["change-review.plan"]).toMatchObject({ kind });
		expect(instructions(initial, "change-review.plan")).toContain(changeInput.request);
		expect(identities(initial)).toEqual([
			{ node: "change-review.plan", command: "planned", event: "PLANNED" },
		]);
		const result = await fixture.raw({
			...fixture.request,
			start: simulationStart(origin, changeInput),
			events: [event("change-review.plan", "planned", plan)],
		});
		expect(result.code).toBe(FAILURE);
		expect(JSON.parse(result.stdout)).toMatchObject({
			reason: "simulation_unsupported",
			step: FIRST,
		});
		const failure = z.object({ message: z.string() }).parse(JSON.parse(result.stdout));
		expect(failure.message).toContain(detail);
		await fixture.assertUnchanged();
	},
);

// eslint-disable-next-line max-statements -- Verify child rendering, validation and rejected parent messaging.
test("shipped retained reviewer validates revision and rejects sendParent without advancing the parent", async () => {
	const child = changeReviewReviewer.getPersistedSnapshot(
		initialTransition(changeReviewReviewer, reviewerInput)[FIRST],
	);
	const root = changeReviewMachine.getPersistedSnapshot(
		initialTransition(changeReviewMachine, changeInput)[FIRST],
	);
	const snapshot = {
		...root,
		children: { "round-1-simulation": { src: "reviewer", snapshot: child } },
	};
	const fixture = await exampleFixture(changeReview, changeInput, {
		snapshot,
		published: {
			node: "change-reviewer.review",
			path: ["round-1-simulation"],
			context: reviewerInput,
		},
	});
	const request = { ...fixture.request, actorId: 'actor:["round-1-simulation"]' };
	const initial = await fixture.raw(request);
	expect(initial.code, initial.stdout).toBe(SUCCESS);
	const result = workflowSimulationSchema.parse(JSON.parse(initial.stdout));
	expect(result.actor.path).toEqual(["round-1-simulation"]);
	expect(result.actor.instructions["change-reviewer.review"]).toMatchObject({
		kind: "frozen",
		title: reviewTask.title,
	});
	expect(instructions(result, "change-reviewer.review")).toContain(
		`Assigned revision: ${plan.revision}`,
	);
	expect(identities(result)).toEqual([
		{ node: "change-reviewer.review", command: "approved", event: "approved" },
		{ node: "change-reviewer.review", command: "changes", event: "changes" },
	]);
	const stale = await fixture.raw({
		...request,
		events: [event("change-reviewer.review", "approved", { ...approval, revision: "wrong" })],
	});
	expect(stale.code).toBe(FAILURE);
	expect(JSON.parse(stale.stdout)).toMatchObject({
		reason: "simulation_invalid_event",
		step: FIRST,
	});
	const complete = await fixture.raw({
		...request,
		events: [event("change-reviewer.review", "approved", approval)],
	});
	expect(complete.code).toBe(FAILURE);
	expect(JSON.parse(complete.stdout)).toMatchObject({
		ok: false,
		kind: "workflow_simulation",
		reason: "simulation_unsupported",
		step: FIRST,
		node: "change-reviewer.review",
		command: "approved",
	});
	expect(JSON.parse(complete.stdout)).not.toHaveProperty("actor");
	const initialChild = await fixture.raw({
		...request,
		start: { kind: "initial", input: reviewerInput },
	});
	expect(JSON.parse(initialChild.stdout)).toMatchObject({ reason: "simulation_unsupported" });
	const rootReplay = await fixture.raw(fixture.request);
	expect(JSON.parse(rootReplay.stdout)).toMatchObject({ reason: "simulation_unsupported" });
	expect(await fixture.raw(request)).toEqual(initial);
	await fixture.assertUnchanged();
});

// --- Private fixtures ---

function event(node: string, command = "next", data: Event["data"] = {}): Event {
	return { node, command, data };
}

function shoppingPath(recipe: string): Event[] {
	return [
		event(`groceries.recipes.${recipe}`),
		event("groceries.dietary.check", "safe"),
		event("groceries.pantry.count"),
	];
}

function identities(result: WorkflowSimulation) {
	return result.choices.map(({ node, command, event: type }) => ({ node, command, event: type }));
}

// eslint-disable-next-line max-statements -- Seed memory records and expose the public CLI boundary.
async function exampleFixture(
	definition: Definition,
	input: unknown,
	options: { snapshot?: Run["snapshot"]; published?: PublishedVisit } = {},
) {
	const { snapshot: savedSnapshot, published } = options;
	const beads = createMemoryBeads({ db });
	const scope = { db, cwd: repo, actor: "fixture" };
	const parent = await beads.create(scope, { title: "Example run", owner: "test-human" });
	const visit = await beads.create(scope, {
		title: "Published visit",
		parent: parent.id,
		owner: "test-human",
	});
	const snapshot =
		savedSnapshot ??
		definition.machine.getPersistedSnapshot(initialTransition(definition.machine, input)[FIRST]);
	const active: ActiveEntry[] = [];
	if (published) {
		let { machine } = definition;
		if (published.path.length !== EMPTY) {
			machine = changeReviewReviewer;
		}
		const node = machine.getStateNodeById(published.node);
		active.push({
			...published,
			bead: visit.id,
			key: `${published.path.join(":")}:${published.node}`,
			request: null,
			meta: renderTask(metadataSchema.parse(node.meta), published.context),
		});
	}
	const saved: Run = {
		formatVersion: 1,
		id: parent.id,
		hash: "saved-example-hash",
		definition: { kind: "named", name: "example", version: "1.0.0" },
		snapshot,
		active,
		created: [],
		history: [],
		visits: {},
	};
	const checkpoint = await beads.create(scope, {
		title: "Checkpoint",
		owner: "test-human",
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
		readBytes: () => Promise.resolve(new ArrayBuffer(EMPTY)),
		isFile: () => Promise.resolve(true),
		importModule: () => Promise.resolve(definition),
	};
	const args = ["--repo", repo, "--db", db];
	const baseline = await captureCli([...args, "system", "preview", parent.id, "--json"], services);
	expect(baseline.code, baseline.stdout).toBe(SUCCESS);
	const inspection = workflowInspectionSchema.parse(JSON.parse(baseline.stdout));
	const request: WorkflowSimulationRequest = {
		checkpoint: inspection.checkpoint,
		savedAt: inspection.savedAt,
		definitionHash: inspection.definition.currentHash,
		actorId: "actor:[]",
		start: { kind: "saved" },
		events: [],
	};
	const records = async () => {
		const { issues } = await beads.list(scope, { all: true, limit: EMPTY });
		return beads.showMany(scope, issues.map(({ id }) => id).toSorted());
	};
	const before = JSON.stringify(await records());
	const raw = (body: unknown) =>
		captureCli(
			[...args, "system", "simulate", parent.id, "--request", JSON.stringify(body), "--json"],
			services,
		);
	return {
		request,
		raw,
		assertUnchanged: async () => {
			expect(JSON.stringify(await records())).toBe(before);
		},
		simulate: async (events: Event[], origin: Origin = "saved") => {
			const start = simulationStart(origin, input);
			const result = await raw({ ...request, start, events });
			expect(result.code, result.stdout).toBe(SUCCESS);
			expect(result.stderr).toBe("");
			return workflowSimulationSchema.parse(JSON.parse(result.stdout));
		},
	};
}

function simulationStart(origin: Origin, input: unknown): WorkflowSimulationRequest["start"] {
	if (origin === "initial") {
		return { kind: origin, input: z.json().parse(input) };
	}
	return { kind: origin };
}

function instructions(result: WorkflowSimulation, node: string): string {
	return z.object({ instructions: z.string() }).parse(result.actor.instructions[node]).instructions;
}

function forbidden(): never {
	throw new Error("Simulation must not publish native changes");
}
