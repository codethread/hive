import { WorkflowCommandError, workflowCommands } from "./workflows.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import { reportFailure } from "./cli.ts";

const endpoint = { actor: "agent", db: "/tracker/beads.db", repo: "/execution" };
const FIRST = 0;
const WORK_ARGUMENTS = -3;
// Unpublished Bee dispatch requests have explicit null identity in the Busybee response.
// eslint-disable-next-line unicorn/no-null
const run = { id: "run-1", status: "active", active: [{ bead: "stage-1", request: null }] };
const output = JSON.stringify({ ok: true, kind: "run", ...run });
const calls: { argv: string[]; cwd: string }[] = [];
const commands = workflowCommands({
	execute: (argv, cwd) => {
		calls.push({ argv, cwd });
		if (argv.includes("--prepare-driver")) {
			return Promise.resolve(
				JSON.stringify({
					ok: true,
					kind: "workflow_advance",
					mode: "prepare-driver",
					runId: run.id,
					status: run.status,
					checkpoint: "checkpoint-1",
				}),
			);
		}
		return Promise.resolve(output);
	},
});

test.each([
	{ selection: { kind: "named" as const, name: "do-work" }, command: ["run", "do-work"] },
	{ selection: { kind: "named" as const, name: "land" }, command: ["run", "land"] },
	{
		selection: { kind: "source" as const, path: "/caller/workflow.ts" },
		command: ["start", "/caller/workflow.ts"],
	},
])(
	"#test-108 workflow adapter forwards parent and endpoint for $command",
	async ({ selection, command }) => {
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
	},
);

test("driver admission selects advance preparation with the selected endpoint", async () => {
	calls.length = 0;
	expect(await commands.advance({ runId: run.id, mode: "prepare-driver" }, endpoint)).toEqual({
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
				"advance",
				run.id,
				"--prepare-driver",
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

test("Busybee partial failure retains its checkpoint and lock identity", async () => {
	const failureResult: unknown = await failed
		.advance({ runId: run.id, mode: "prepare-driver" }, endpoint)
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

test("lifecycle adapter reads source-independent publication fences at the selected endpoint", async () => {
	const lifecycle = {
		runId: "run-1",
		nativeStatus: "open",
		updatedAt: "now",
		publication: {
			checkpoint: "checkpoint-1",
			savedAt: "now",
			locked: true,
			settlement: "pending" as const,
		},
		lifecycle: { kind: "pending" as const },
		resolution: { kind: "unresolved" as const },
	};
	const requests: string[][] = [];
	const adapter = workflowCommands({
		execute: (argv, cwd) => {
			expect(cwd).toBe(endpoint.repo);
			requests.push(argv);
			return Promise.resolve(
				JSON.stringify({ ok: true, kind: "workflow_lifecycle", ...lifecycle }),
			);
		},
	});
	expect(await adapter.inspect("run-1", endpoint)).toEqual(lifecycle);
	expect(requests).toEqual([
		[
			"busybee",
			"--repo",
			endpoint.repo,
			"--db",
			endpoint.db,
			"--actor",
			endpoint.actor,
			"--json",
			"inspect",
			"run-1",
		],
	]);
});

const workExpansion = {
	id: "run-1",
	status: "active",
	checkpoint: "checkpoint-1",
	savedAt: "now",
	constraints: "Read original choice schemas",
	active: [
		{
			...run.active[FIRST],
			title: "Work",
			instructions: "Frozen brief",
			context: {},
			commands: ["next"],
			path: [],
			choices: [{ choice: "next", schema: { type: "object" } }],
		},
	],
};
const workCases = [
	{ expansion: { kind: "available", data: workExpansion }, reason: "" },
	{
		expansion: {
			kind: "unavailable",
			reason: "definition_changed",
			message: "Version changed",
			context: { runId: "run-1", savedVersion: "1.0.0" },
		},
		reason: "definition_changed",
	},
];

test.each(workCases)(
	"work adapter preserves typed expansion availability: $reason",
	async ({ expansion, reason }) => {
		const requests: string[][] = [];
		const adapter = workflowCommands({
			execute: (argv) => {
				requests.push(argv);
				return Promise.resolve(
					JSON.stringify({
						ok: true,
						kind: "workflow_lifecycle",
						runId: "run-1",
						nativeStatus: "open",
						updatedAt: "now",
						publication: {
							checkpoint: "checkpoint-1",
							savedAt: "now",
							locked: false,
							settlement: "none",
						},
						lifecycle: { kind: "pending" },
						resolution: { kind: "unresolved" },
						work: expansion,
					}),
				);
			},
		});
		if (reason) {
			await expect(adapter.work("run-1", endpoint)).rejects.toMatchObject({
				reason,
				context: { runId: "run-1", savedVersion: "1.0.0" },
			});
		} else {
			expect(await adapter.work("run-1", endpoint)).toEqual(run);
		}
		expect(requests[FIRST]?.slice(WORK_ARGUMENTS)).toEqual(["inspect", "run-1", "--work"]);
	},
);
