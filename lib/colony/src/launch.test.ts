/* eslint-disable unicorn/no-null -- Recipes explicitly preserve canonical-default cwd. */
import { WORKFLOW_SETTLEMENT_PREFIX, recipeSchema, renderResponseInstructions } from "@hive/shared";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { eligibility, prepareLaunch, renderExecutionRecipe } from "./launch.ts";
import { expect, test } from "bun:test";
import { RESPONSE_PROTOCOL } from "./response-protocol.ts";
import { trackerScope } from "./tracker.ts";

const workflows = { inspect: () => Promise.reject(new Error("Unexpected workflow inspection")) };

test("preparation refuses another host before resolving task or process authority", async () => {
	const tracker = memoryTracker();
	const task = await createTask(tracker);
	const id = await createSpawn(tracker, task);
	await tracker.beads.update(trackerScope(tracker.repository, "submitter"), [id], {
		description: JSON.stringify({
			assignment: { kind: "driver", runId: task },
			cwd: null,
			effort: "low",
			harness: "fixture",
			host: "foreign-host",
			kind: "worker",
			model: "fixture",
			prompt: "Complete tasks",
			system_prompt: "Worker role",
		}),
	});
	await expect(
		prepareLaunch(
			{
				...tracker.repository,
				beads: tracker.beads,
				workflows,
				id,
				state: "/unused/private-state",
			},
			{},
			"unused-attempt",
		),
	).rejects.toBeInstanceOf(Error);
});

const recipe = recipeSchema.parse({
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Captured execution direction",
	system_prompt: "Captured specialist role",
});

test.each([
	{ assignment: { kind: "driver", runId: "run-1" }, target: "run-1" },
	{ assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" }, target: "stage-1" },
] as const)(
	"managed $target launch composes delivery without changing the captured recipe",
	({ assignment, target }) => {
		const captured = structuredClone(recipe);
		const rendered = renderExecutionRecipe({ assignment, recipe, taskIds: [target] });
		expect(rendered.prompt).toContain(renderResponseInstructions({ taskId: target }));
		expect(rendered.prompt).toContain(recipe.prompt);
		expect(rendered.system_prompt).toBe(`${recipe.system_prompt}\n\n${RESPONSE_PROTOCOL}`);
		expect(recipe).toEqual(captured);
	},
);

const readinessCases = ["task", "epic"].flatMap((type) => [
	{ type, blocked: false },
	{ type, blocked: true },
]);

// Exercise the native readiness seam without launching a process.
// eslint-disable-next-line max-statements
test.each(readinessCases)(
	"Bee-dispatched stage under $type waits only for actual ancestor prerequisites (blocked: $blocked)",
	// Exercise initial waiting, actionable support and admission after prerequisite completion.
	// eslint-disable-next-line max-statements
	async ({ type, blocked }) => {
		const context = memoryTracker();
		const parent = await createTask(context, { type });
		const run = await createTask(context, { parent });
		const stage = await createTask(context, { parent: run });
		const actionable = await createTask(context);
		const blocker = await createTask(context, { parent: actionable });
		const scope = trackerScope(context.repository, "inspector");
		if (blocked) {
			await context.beads.dep.add(scope, parent, blocker, "blocks");
		}
		const tasks = [await context.beads.show(scope, stage)];
		let ready = await context.beads.ready(scope, { limit: 0 });
		let expected: "eligible" | "waiting" = "eligible";
		if (blocked) {
			expected = "waiting";
		}
		expect(
			eligibility(tasks, ready, "worker", { kind: "stage", runId: "run", stageId: stage }).kind,
		).toBe(expected);
		const supporting = [await context.beads.show(scope, blocker)];
		expect(eligibility(supporting, ready, "worker", { kind: "driver", runId: blocker }).kind).toBe(
			"eligible",
		);
		await context.beads.close(scope, blocker);
		ready = await context.beads.ready(scope, { limit: 0 });
		expect(
			eligibility(tasks, ready, "worker", { kind: "stage", runId: "run", stageId: stage }).kind,
		).toBe("eligible");
	},
);

test.each([
	{ outcome: "cancelled", requestOutcome: "cancelled" },
	{ outcome: "failed", requestOutcome: "blocked" },
] as const)(
	"preparation settles $outcome without launching or inspecting a definition",
	async ({ outcome, requestOutcome }) => {
		const current = memoryTracker();
		const runId = await createTask(current);
		const requestId = await createSpawn(current, runId);
		const scope = trackerScope(current.repository, "worker");
		await current.beads.close(scope, runId, {
			reason: JSON.stringify({
				kind: "busybee-lifecycle",
				formatVersion: 1,
				scope: "run",
				runId,
				outcome,
				reason: "Native disposition",
			}),
		});
		expect(
			await prepareLaunch(
				{ ...current.repository, beads: current.beads, workflows, id: requestId, state: "/unused" },
				{},
				"unused-attempt",
			),
		).toMatchObject({ kind: "finished", outcome: requestOutcome });
		expect(await current.beads.show(scope, requestId)).toMatchObject({ status: "open" });
	},
);

test.each([
	{ locked: true, settlement: "none" as const },
	{ locked: false, settlement: "pending" as const },
])(
	"preparation fences publication lock $locked and settlement $settlement before process effects",
	async ({ locked, settlement }) => {
		const current = memoryTracker();
		const runId = await createTask(current);
		const requestId = await createSpawn(current, runId);
		const inspect = (selected: string, endpoint: { repo: string; db: string; actor: string }) => {
			expect(selected).toBe(runId);
			expect(endpoint).toEqual({
				repo: current.repository.root,
				db: current.repository.beadsDb,
				actor: "worker",
			});
			return Promise.resolve({
				runId,
				nativeStatus: "open",
				updatedAt: "now",
				publication: { checkpoint: "checkpoint", savedAt: "now", locked, settlement },
				lifecycle: { kind: "pending" as const },
				resolution: { kind: "unresolved" as const },
			});
		};
		expect(
			await prepareLaunch(
				{
					...current.repository,
					beads: current.beads,
					workflows: { inspect },
					id: requestId,
					state: "/unused",
				},
				{},
				"unused-attempt",
			),
		).toMatchObject({ kind: "waiting" });
		const native = await current.beads.show(trackerScope(current.repository, "worker"), runId);
		expect(native.assignee).toBeUndefined();
	},
);

test("preparation rechecks native settlement intent after the public observation", async () => {
	const current = memoryTracker();
	const runId = await createTask(current);
	const requestId = await createSpawn(current, runId);
	const inspect = async () => {
		await current.beads.update(trackerScope(current.repository, "publisher"), [runId], {
			notes:
				WORKFLOW_SETTLEMENT_PREFIX +
				JSON.stringify({
					owner: "publisher",
					runId,
					operation: "cancel",
					reason: "Withdrawn",
					replacementId: null,
					inventory: [],
				}),
		});
		return {
			runId,
			nativeStatus: "open",
			updatedAt: "now",
			publication: {
				checkpoint: "checkpoint",
				savedAt: "now",
				locked: false,
				settlement: "none" as const,
			},
			lifecycle: { kind: "pending" as const },
			resolution: { kind: "unresolved" as const },
		};
	};
	await expect(
		prepareLaunch(
			{
				...current.repository,
				beads: current.beads,
				workflows: { inspect },
				id: requestId,
				state: "/unused",
			},
			{},
			"unused-attempt",
		),
	).rejects.toBeInstanceOf(Error);
});
