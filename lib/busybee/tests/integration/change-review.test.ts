import { expect, test } from "bun:test";
import { inputSchema, machine } from "../../examples/change-review/workflow.ts";
import { metadataSchema, renderTask } from "../../src/definition.ts";
import { initialTransition } from "xstate";

const SHA_LENGTH = 40;
const planner = metadataSchema.parse(machine.states.plan!.meta);
const change = {
	base: "a".repeat(SHA_LENGTH),
	request: "Review the change against the requested behavior",
	title: "Example change",
};
const cases = [
	{ execution: { mode: "driver-handled" }, bee: undefined },
	{ execution: { mode: "bee-dispatched", kind: "reviewer" }, bee: { kind: "reviewer" } },
].map(({ execution, bee }) => {
	const input = inputSchema.parse({ ...change, execution });
	const [snapshot] = initialTransition(machine, input);
	return { mode: execution.mode, context: snapshot.context, bee };
});

test.each(cases)(
	"change-review renders $mode work with the selected dispatch #test-614",
	({ context, bee }) => {
		const task = renderTask(planner, { ...context });
		expect(task.bee).toEqual(bee);
		expect(task.commands).toEqual({ planned: "PLANNED" });
	},
);
