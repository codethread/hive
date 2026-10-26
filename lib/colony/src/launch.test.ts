/* eslint-disable unicorn/no-null -- Recipes explicitly preserve canonical-default cwd. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { eligibility, prepareLaunch, renderExecutionRecipe } from "./launch.ts";
import { expect, test } from "bun:test";
import { recipeSchema, renderResponseInstructions } from "@hive/shared";
import { RESPONSE_PROTOCOL } from "./response-protocol.ts";
import { trackerScope } from "./tracker.ts";

const tracker = memoryTracker();
const task = await createTask(tracker, { status: "closed" });
const id = await createSpawn(tracker, task);

test("preparation refuses another host before resolving task or process authority", async () => {
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
			{ ...tracker.repository, beads: tracker.beads, id, state: "/unused/private-state" },
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

const readinessCases = await Promise.all(
	["epic"].flatMap((type) =>
		[true].map(async (blocked) => {
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
			return { context, scope, parent, run, stage, blocker, type, blocked };
		}),
	),
);

// Exercise the native readiness seam without launching a process.
// eslint-disable-next-line max-statements
test.each(readinessCases)(
	"Bee-dispatched stage under $type waits only for actual ancestor prerequisites (blocked: $blocked)",
	// Exercise initial waiting, actionable support and admission after prerequisite completion.
	// eslint-disable-next-line max-statements
	async ({ context, scope, stage, blocker, blocked }) => {
		const tasks = [await context.beads.show(scope, stage)];
		let ready = await context.beads.ready(scope, { limit: 0 });
		let expected: "eligible" | "waiting" = "eligible";
		if (blocked) {
			expected = "waiting";
		}
		expect(eligibility(tasks, ready, "worker", { kind: "pending" }).kind).toBe(expected);
		const supporting = [await context.beads.show(scope, blocker)];
		expect(eligibility(supporting, ready, "worker", { kind: "pending" }).kind).toBe("eligible");
		await context.beads.close(scope, blocker);
		ready = await context.beads.ready(scope, { limit: 0 });
		expect(eligibility(tasks, ready, "worker", { kind: "pending" }).kind).toBe("eligible");
	},
);
