/* eslint-disable unicorn/no-null -- Recipes explicitly preserve canonical-default cwd. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { prepareLaunch } from "./launch.ts";
import { trackerScope } from "./tracker.ts";

const tracker = memoryTracker();
const task = await createTask(tracker, { status: "closed" });
const id = await createSpawn(tracker, [task]);

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
