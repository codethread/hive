import { WorkflowCommandError, workflowCommands } from "./workflows.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";

const endpoint = { actor: "agent", db: "/tracker/beads.db", repo: "/execution" };
// Unpublished Bee dispatch requests have explicit null identity in the Busybee response.
// eslint-disable-next-line unicorn/no-null
const run = { id: "run-1", status: "active", active: [{ bead: "stage-1", request: null }] };
const output = JSON.stringify({ ok: true, kind: "run", ...run });
const calls: { argv: string[]; cwd: string }[] = [];
const commands = workflowCommands({
	execute: (argv, cwd) => {
		calls.push({ argv, cwd });
		if (argv.includes("prepare-driver")) {
			return Promise.resolve(
				JSON.stringify({ ok: true, runId: run.id, status: run.status, checkpoint: "checkpoint-1" }),
			);
		}
		return Promise.resolve(output);
	},
});
// Compile the boundary schema outside the measured behavior tests.
await commands.show(run.id, endpoint);
calls.length = 0;

test("driver admission uses Busy Bee system with the selected endpoint #test-492", async () => {
	calls.length = 0;
	expect(await commands.prepareDriver(run.id, endpoint)).toEqual({
		runId: run.id,
		status: run.status,
		checkpoint: "checkpoint-1",
	});
	expect(calls).toEqual([
		{
			argv: [
				"busybee",
				"--repo",
				endpoint.repo,
				"--db",
				endpoint.db,
				"--actor",
				endpoint.actor,
				"--json",
				"system",
				"prepare-driver",
				run.id,
			],
			cwd: endpoint.repo,
		},
	]);
});

const failure = {
	ok: false,
	kind: "start",
	reason: "partial_effects",
	message: "Inspect retained ownership",
	checkpoint: "checkpoint-1",
	owner: "lock-1",
};
const failed = workflowCommands({
	execute: () =>
		Promise.reject(
			new CommandError("busybee", {
				code: 1,
				stdout: JSON.stringify(failure),
				stderr: "",
			}),
		),
});
// Warm the error boundary too.
await failed.show(run.id, endpoint).catch(() => {});

test("Busybee partial failure retains its checkpoint and lock identity", async () => {
	const failureResult: unknown = await failed
		.prepareDriver(run.id, endpoint)
		.catch((error: unknown) => error);
	expect(failureResult).toBeInstanceOf(WorkflowCommandError);
	expect(failureResult).toMatchObject({
		reason: "partial_effects",
		context: { checkpoint: "checkpoint-1", owner: "lock-1" },
	});
});
