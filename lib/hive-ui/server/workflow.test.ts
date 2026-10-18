import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import type { WorkflowSimulationRequest } from "@hive/shared";
import { colony } from "../src/stories/fixtures.ts";
import { createWorkflowTools } from "./workflow.ts";
import { workflowSimulationSchema } from "@hive/shared";

const request: WorkflowSimulationRequest = {
	checkpoint: "checkpoint",
	savedAt: "saved",
	definitionHash: "definition",
	actorId: "root",
	start: { kind: "saved" },
	events: [{ node: "flow.work", command: "next", data: { evidence: "simulation" } }],
};
const simulation = workflowSimulationSchema.parse({
	formatVersion: 1,
	runId: "run",
	actor: {
		id: "root",
		path: [],
		machine: { id: "flow", initial: "work", states: { work: {} } },
		snapshot: { value: "work", status: "active" },
		instructions: { "flow.work": { kind: "none" } },
	},
	choices: [],
	inputSchema: {},
});

test("simulation adapter pins the selected endpoint and passes replay as one JSON argument", async () => {
	const calls: { argv: string[]; cwd: string }[] = [];
	const tools = createWorkflowTools((argv, cwd) => {
		calls.push({ argv, cwd });
		return Promise.resolve(
			JSON.stringify({ ok: true, kind: "workflow_simulation", ...simulation }),
		);
	});
	expect(await tools.simulate(colony, "run", request)).toEqual(simulation);
	expect(calls).toEqual([
		{
			cwd: colony.root,
			argv: [
				"busybee",
				"--repo",
				colony.root,
				"--db",
				colony.beadsDb,
				"system",
				"simulate",
				"run",
				"--request",
				JSON.stringify(request),
				"--json",
			],
		},
	]);
});

test("simulation adapter retains the CLI failure as its cause and rejects malformed success", async () => {
	const failure = new CommandError("busybee", {
		code: 1,
		stdout: JSON.stringify({
			ok: false,
			reason: "simulation_stale_baseline",
			message: "Refresh the workflow",
		}),
		stderr: "",
	});
	const failed = createWorkflowTools(() => Promise.reject(failure));
	const result = await failed.simulate(colony, "run", request).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(Error);
	expect(result).toMatchObject({ cause: failure });
	const malformed = createWorkflowTools(() =>
		Promise.resolve(JSON.stringify({ ok: true, kind: "workflow_simulation" })),
	);
	const rejected = await malformed
		.simulate(colony, "run", request)
		.catch((error: unknown) => error);
	expect(rejected).toBeInstanceOf(Error);
});
