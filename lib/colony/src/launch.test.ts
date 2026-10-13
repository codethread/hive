/* eslint-disable unicorn/no-null -- Recipes explicitly preserve canonical-default cwd. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { prepareLaunch, renderExecutionPrompt } from "./launch.ts";
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
test("driver launch guides existing-run coordination and durable manual delivery", () => {
	const prompt = renderExecutionPrompt({
		assignment: { kind: "driver", runId: "run-1" },
		recipe,
		taskIds: ["run-1"],
	});
	expect(prompt).toContain("Coordinate the existing Busy Bee workflow run run-1");
	expect(prompt).toContain("busybee discover run-1 --json");
	expect(prompt).toContain(
		"Before closing each manual stage, use busybee record-result run-1 STAGE CHOICE --data-file FILE",
	);
	expect(prompt).toContain("busybee next run-1 STAGE");
	expect(prompt).toContain("busybee choice run-1 STAGE CHOICE --data-file FILE");
	expect(prompt).toContain("busybee collect run-1 --json");
	expect(prompt).toContain("Never manually close run run-1");
	expect(prompt).toContain("bee finish success only after Busy Bee reports status done");
	expect(prompt).toContain("run-1 as their native parent");
	expect(prompt).toContain("Independent delegation remains separate");
	expect(prompt).toContain("bee finish blocked --reason");
	expect(prompt).toContain(recipe.prompt);
	expect(recipe.prompt).toBe("Captured execution direction");
});

test("automatic stage launch requires result before closure and leaves navigation to the driver", () => {
	const prompt = renderExecutionPrompt({
		assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" },
		recipe,
		taskIds: ["stage-1"],
	});
	expect(prompt).toContain("Perform only the assigned automatic visit stage-1");
	expect(prompt).toContain("busybee record-result run-1 stage-1 CHOICE --data-file FILE");
	expect(prompt).toContain("before closing the stage");
	expect(prompt).toContain("do not call busybee next, choice or collect");
	expect(prompt).toContain("do not close grouping beads or run run-1");
	expect(prompt).toContain("run-1 as their native parent");
	expect(prompt).toContain("Related tasks: stage-1");
	expect(prompt).toContain("then call bee finish success");
});
