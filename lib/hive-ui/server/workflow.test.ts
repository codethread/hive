import { expect, test } from "bun:test";
import { samplePreview, workflowSamples } from "../src/stories/workflow-samples.ts";
import { CommandError } from "@hive/beads";
import { colony } from "../src/stories/fixtures.ts";
import { createWorkflowReader } from "./workflow.ts";

const preview = samplePreview(workflowSamples[0]!);
const failure = new CommandError("busybee", {
	code: 1,
	stdout: JSON.stringify({
		ok: false,
		message: "Definition land is unavailable",
		reason: "workflow_missing",
	}),
	stderr: "",
});
const success = JSON.stringify({ ok: true, kind: "workflow_preview", ...preview });

test("workflow command binds the server-selected repository and database", async () => {
	const calls: { argv: string[]; cwd: string }[] = [];
	const read = createWorkflowReader((argv, cwd) => {
		calls.push({ argv, cwd });
		return Promise.resolve(success);
	});
	expect(await read(colony, "run-1")).toEqual(preview);
	expect(calls).toEqual([
		{
			argv: [
				"busybee",
				"--repo",
				colony.root,
				"--db",
				colony.beadsDb,
				"preview",
				"run-1",
				"--json",
			],
			cwd: colony.root,
		},
	]);
});

test("workflow command preserves the producer diagnostic on nonzero exit", async () => {
	const read = createWorkflowReader(() => Promise.reject(failure));
	const result = await read(colony, "run-1").catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	if (!(result instanceof Error)) {
		throw new Error("Expected the producer failure");
	}
	expect(result.message).toMatchInlineSnapshot(`"Definition land is unavailable"`);
});
