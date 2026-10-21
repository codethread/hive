import {
	commandSchemas,
	inputSchema,
	machine,
} from "../../../../.workflows/do-feature-task/workflow.ts";
import { expect, test } from "bun:test";
import { initialTransition, transition } from "xstate";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import type { SnapshotFrom } from "xstate";

const EVENT_ARGUMENT = 1;
const input = inputSchema.parse({
	canonicalRoot: "/canonical",
	base: { path: "/feature", branch: "feat/example" },
	isolation: { path: "/task", branch: "task/example" },
});
const evidence = "SIMULATED observations; no real check, review or Git operation.";
const data = { evidence };
type Snapshot = SnapshotFrom<typeof machine>;
type Choice = keyof typeof commandSchemas;
const [initial] = initialTransition(machine, input);
const working = advance(initial, "next");
const reviewing = advance(working, "next");
const delivering = advance(reviewing, "approved");

// The chart is the public process: review is a separate native visit, not prose inside implementation.

test.each([
	{ name: "changed delivery candidate", snapshot: delivering, choice: "changes" as const },
])("$name returns through checked work and a fresh review #test-620", ({ snapshot, choice }) => {
	const repair = advance(snapshot, choice);
	expect(repair.value).toBe("work");
	expect(repair.context.evidence).toBe(evidence);
	expect(advance(repair, "next").value).toBe("review");
});

function advance(snapshot: Snapshot, choice: Choice): Snapshot {
	const event = {
		type: task(snapshot).commands![choice]!,
		data: commandSchemas[choice].parse(data),
	} as Parameters<typeof machine.transition>[typeof EVENT_ARGUMENT];
	const [next, effects] = transition(machine, snapshot, event);
	expect(effects).toEqual([]);
	return next;
}

function task(snapshot: Snapshot) {
	return renderTask(metadataSchema.parse(snapshot.getMeta()[`do-feature-task.${snapshot.value}`]), {
		...snapshot.context,
	});
}
