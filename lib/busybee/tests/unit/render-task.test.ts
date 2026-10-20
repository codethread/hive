import { expect, test } from "bun:test";
import { renderTask } from "../../src/definition.ts";
import { z } from "zod";

test.each([
	{
		name: "metadata defaults",
		result: { instructions: "Work" },
		expected: { title: "Worker", commands: { next: "NEXT" } },
	},
	{
		name: "author overrides",
		result: {
			title: "Override",
			instructions: "Other work",
			commands: { done: "DONE" },
			bee: { kind: "worker" },
		},
		expected: { title: "Override", commands: { done: "DONE" }, bee: { kind: "worker" } },
	},
])("task rendering resolves $name #test-520", ({ result, expected }) => {
	const context = { result };
	const rendered = renderTask(
		{
			title: "Worker",
			commands: { next: "NEXT" },
			task: (input) => {
				expect(input.context).toBe(context);
				return input.context["result"];
			},
		},
		context,
	);
	expect(rendered).toEqual({ ...expected, instructions: result.instructions });
});

test.each([
	{ name: "nonrecord result", result: "not a record" },
	{ name: "invalid title override", result: { title: "", instructions: "Work" } },
])("task rendering rejects $name #test-360", ({ result }) => {
	expect(() => renderTask({ title: "Worker", task: () => result }, {})).toThrow(z.ZodError);
});
