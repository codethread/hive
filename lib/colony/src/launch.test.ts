/* eslint-disable unicorn/no-null -- Recipes explicitly preserve canonical-default cwd. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { eligibility, prepareLaunch, renderExecutionPrompt } from "./launch.ts";
import { expect, test } from "bun:test";
import { recipeSchema } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const tracker = memoryTracker();
const task = await createTask(tracker, { status: "closed" });
const id = await createSpawn(tracker, task);

test("preparation finishes completed requests before formula or process effects", async () => {
	const prepared = await prepareLaunch(
		{ ...tracker.repository, beads: tracker.beads, id, state: "/unused/private-state" },
		{},
		"unused-attempt",
	);
	expect(prepared).toEqual({ kind: "finished" });
});

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

// The rendered launch protocol is the complete agent-facing delivery contract.
// eslint-disable-next-line max-statements
test("driver launch guides existing-run coordination and durable driver-handled delivery", () => {
	const prompt = renderExecutionPrompt({
		assignment: { kind: "driver", runId: "run-1" },
		recipe,
		taskIds: ["run-1"],
	});
	expect(prompt).toContain("Coordinate the existing Busy Bee workflow run run-1");
	expect(prompt).toContain("busybee discover run-1 --json");
	expect(prompt).toContain(
		"On retry, reacquire unfinished driver-handled visits under your current identity",
	);
	expect(prompt).toContain("claiming only unassigned visits or your own claims");
	expect(prompt).toContain("Preserve other identities and human/HITL reservations");
	expect(prompt).toContain(
		"Before closing each driver-handled stage, use busybee record-result run-1 STAGE CHOICE --data-file FILE",
	);
	expect(prompt).toContain("busybee next run-1 STAGE");
	expect(prompt).toContain("busybee choice run-1 STAGE CHOICE --data-file FILE");
	expect(prompt).toContain("busybee collect run-1 --json");
	expect(prompt).toContain("Never manually close run run-1");
	expect(prompt).toContain("bee finish success only after Busy Bee reports status done");
	expect(prompt).toContain("run-1 as their native parent");
	expect(prompt).toContain("Independent delegation remains separate");
	expect(prompt).toContain("bee finish blocked --reason");
	expect(prompt).toContain("bee response publish run-1 --body-file FILE --json");
	expect(prompt).toContain(
		"Publish one final run response containing your full answer or meaningful synthesis",
	);
	expect(prompt).toContain("bee result REQUEST --json");
	expect(prompt).toContain("publish the full result against the run before closing the last stage");
	expect(prompt).toContain(
		"For blocked work, publish and verify a blocker report against the same target",
	);
	expect(prompt).toContain("Workflow notes contain only the original machine {choice,data}");
	expect(prompt).toContain(recipe.prompt);
	expect(recipe.prompt).toBe("Captured execution direction");
});

// Verify delivery target, ordering and the worker's workflow authority together.
// eslint-disable-next-line max-statements
test("Bee-dispatched stage launch requires result before closure and leaves navigation to the driver", () => {
	const prompt = renderExecutionPrompt({
		assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" },
		recipe,
		taskIds: ["stage-1"],
	});
	expect(prompt).toContain("Perform only the assigned Bee-dispatched visit stage-1");
	expect(prompt).toContain("busybee record-result run-1 stage-1 CHOICE --data-file FILE");
	expect(prompt).toContain("before closing the stage");
	expect(prompt).toContain("do not call busybee next, choice or collect");
	expect(prompt).toContain("do not close grouping beads or run run-1");
	expect(prompt).toContain("run-1 as their native parent");
	expect(prompt).toContain("Related tasks: stage-1");
	expect(prompt).toContain("then call bee finish success");
	expect(prompt).toContain("bee response publish stage-1 --body-file FILE --json");
	expect(prompt).not.toContain("bee response publish run-1");
	expect(prompt).toContain(
		"publish and verify your stage response before using busybee record-result",
	);
	expect(prompt).toContain(
		"For blocked work, publish and verify a blocker report against the same target",
	);
	expect(prompt).toContain("Response records are closed linked docs, never executable child tasks");
});

const readinessCases = await Promise.all(
	["task", "epic"].flatMap((type) =>
		[false, true].map(async (blocked) => {
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
		expect(eligibility(tasks, ready, "worker").kind).toBe(expected);
		const supporting = [await context.beads.show(scope, blocker)];
		expect(eligibility(supporting, ready, "worker").kind).toBe("eligible");
		await context.beads.close(scope, blocker);
		ready = await context.beads.ready(scope, { limit: 0 });
		expect(eligibility(tasks, ready, "worker").kind).toBe("eligible");
	},
);
