import { WorkflowCommandError, workflowCommands } from "./workflows.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import { reportFailure } from "./cli.ts";

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

test.each([
	{ selection: { kind: "named" as const, name: "do-work" }, command: ["run", "do-work"] },
	{ selection: { kind: "named" as const, name: "land" }, command: ["run", "land"] },
	{
		selection: { kind: "source" as const, path: "/caller/workflow.ts" },
		command: ["start", "/caller/workflow.ts"],
	},
])("workflow adapter forwards parent and endpoint for $command", async ({ selection, command }) => {
	calls.length = 0;
	const result = await commands.start({
		parent: "original-1",
		endpoint,
		owner: "ct",
		inputFile: "/caller/work.json",
		selection,
	});
	expect(result).toEqual(run);
	expect(calls).toEqual([
		{
			argv: [
				"busybee",
				"--repo",
				"/execution",
				"--db",
				"/tracker/beads.db",
				"--actor",
				"agent",
				"--json",
				...command,
				"--parent",
				"original-1",
				"--input-file",
				"/caller/work.json",
				"--owner",
				"ct",
				"--assignee",
				"",
			],
			cwd: "/execution",
		},
	]);
});

test("driver admission uses Busy Bee system with the selected endpoint", async () => {
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

test.each([
	{ context: { parentId: "original-1", uncertainOperation: "create_run" } },
	{ context: { parentId: "original-1", runId: "run-1", uncertainOperation: "create_checkpoint" } },
	{
		context: {
			parentId: "original-1",
			runId: "run-1",
			checkpoint: "checkpoint-1",
			uncertainOperation: "link_checkpoint",
		},
	},
])(
	"initialization failure preserves confirmed identities and uncertain operation: $context",
	async ({ context }) => {
		const initialization = workflowCommands({
			execute: () =>
				Promise.reject(
					new CommandError("busybee", {
						code: 1,
						stderr: "",
						stdout: JSON.stringify({
							ok: false,
							kind: "run",
							reason: "partial_effects",
							message: "Inspect before resubmitting",
							...context,
						}),
					}),
				),
		});
		const failedStart: unknown = await initialization
			.start({
				parent: "original-1",
				endpoint,
				owner: "ct",
				inputFile: "/caller/input.json",
				selection: { kind: "named", name: "do-work" },
			})
			.catch((error: unknown) => error);
		expect(failedStart).toBeInstanceOf(WorkflowCommandError);
		expect(failedStart).toMatchObject({ reason: "partial_effects", context });
		const stdout: string[] = [];
		const stderr: string[] = [];
		reportFailure(failedStart, true, {
			command: "bee",
			stdout: (value) => stdout.push(value),
			stderr: (value) => stderr.push(value),
		});
		expect(JSON.parse(stdout.join(""))).toMatchObject({
			ok: false,
			reason: "partial_effects",
			...context,
		});
		expect(stderr).toEqual([]);
	},
);
