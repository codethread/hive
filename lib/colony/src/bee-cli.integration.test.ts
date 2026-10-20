/* eslint-disable unicorn/no-null -- Request fixtures preserve explicit absence in the public output contract. */
import { expect, test } from "bun:test";
import type { BeeDependencies } from "./bee-cli.ts";
import type { RequestView } from "./requests.ts";
import type { WorkflowSpawnOptions } from "./workflow-submission.ts";
import { runBeeCli } from "./bee-cli.ts";

const PROMPT_REPETITIONS = 500;
const SUCCESS = 0;
const FAILURE = 1;
const USAGE_ERROR = 2;
const SINGLE_DOCUMENT = 1;
const PROMPT = "Captured direction. ".repeat(PROMPT_REPETITIONS);
const ROLE = "Captured role. ".repeat(PROMPT_REPETITIONS);
const repository = { beadsDb: "/fixture/tracker.db", root: "/fixture" };
const request: RequestView = {
	assignment: { kind: "driver", runId: "task-1" },
	acknowledgment: null,
	closeReason: null,
	closedAt: null,
	disposition: { outcome: "pending", resolution: "unresolved" },
	host: "fixture-host",
	id: "request-1",
	identity: "worker",
	labelPublication: "current",
	lastObservation: {
		author: "colony",
		createdAt: "2026-10-13T00:00:00Z",
		text: "running: attempt 1",
	},
	needsAttention: false,
	recipe: {
		cwd: null,
		effort: "low",
		harness: "fixture",
		kind: "worker",
		model: "fixture",
		prompt: PROMPT,
		system_prompt: ROLE,
	},
	resolution: { kind: "unresolved" },
	status: "open",
	stdoutActivity: null,
	supersedes: [],
	tasks: [{ assignee: "worker", id: "task-1", readiness: "blocked", status: "in_progress" }],
};
const stopped: RequestView = {
	...request,
	closeReason: "Stopped by Bee",
	closedAt: "2026-10-13T01:00:00Z",
	disposition: { outcome: "cancelled", resolution: "resolved" },
	resolution: { kind: "resolved" },
	status: "closed",
};
const native = {
	assignee: request.identity,
	description: JSON.stringify(request.recipe),
	id: request.id,
};
const { prompt: _prompt, system_prompt: _role, ...metadata } = request.recipe;
const summary = { ...request, recipe: metadata };

test.each([
	{ args: ["system", "dispatch-stage", "worker", "task-1", "--run", "run-1"] },
	{ args: ["retry", "request-0"] },
])("$args returns the next-command identifiers without native metadata", async ({ args }) => {
	const result = await invoke([...args, "--actor", "test", "--json"]);
	expect(JSON.parse(result.stdout)).toEqual({
		kind: "spawn_created",
		ok: true,
		request: { assignee: "worker", id: "request-1" },
	});
});

test("retry forwards explicit cancellation resumption independently of recipe overrides", async () => {
	await invoke(
		["retry", "request-0", "--resume-cancelled", "--model", "current", "--actor", "test", "--json"],
		SUCCESS,
		{
			retry: (id, options) => {
				expect(id).toBe("request-0");
				expect(options).toMatchObject({ resumeCancelled: true, model: "current" });
				return Promise.resolve({ kind: "spawn_created", request: native });
			},
		},
	);
});

test.each([
	{
		args: ["system", "assess", "--file", "report.json"],
		response: { ok: true, kind: "assessment_submitted", assessmentId: "assessment-1" },
	},
	{
		args: ["system", "report", "request-1", "active"],
		response: {
			ok: true,
			kind: "drone_verdict_submitted",
			requestId: "request-1",
			attemptId: "attempt-1",
			reviewId: "review-1",
		},
	},
])("$args submits the injected protocol and emits one JSON receipt", async ({ args, response }) => {
	const result = await invoke([...args, "--json"], SUCCESS, {
		assess: (file) => {
			expect(file).toBe("report.json");
			return Promise.resolve({ kind: "assessment_submitted", assessmentId: "assessment-1" });
		},
		report: (id, verdict) => {
			expect([id, verdict]).toEqual(["request-1", "active"]);
			return Promise.resolve({
				kind: "drone_verdict_submitted",
				requestId: id,
				attemptId: "attempt-1",
				reviewId: "review-1",
			});
		},
	});
	expect(JSON.parse(result.stdout)).toEqual(response);
});

test.each([
	{
		args: ["spawn", "worker", "--parent", "work-1", "--input-file", "work.json"],
		creation: { parentId: "work-1" },
	},
	{ args: ["attach-workflow", "worker", "run-1"], creation: {} },
])("$args returns the workflow and driver identities", async ({ args, creation }) => {
	const result = await invoke([...args, "--actor", "test", "--json"]);
	expect(JSON.parse(result.stdout)).toEqual({
		kind: "workflow_spawn_created",
		ok: true,
		request: { id: "request-1", identity: "worker" },
		workflow: { runId: "run-1", status: "active", ...creation },
	});
});

test.each([
	{ selector: [] },
	{ selector: ["--workflow", "land"] },
	{ selector: ["--source", "custom/workflow.ts"] },
])(
	"spawn forwards required parent independently of workflow selector $selector",
	async ({ selector }) => {
		const result = await invoke([
			"spawn",
			"worker",
			"--parent",
			"work-1",
			"--input-file",
			"work.json",
			...selector,
			"--actor",
			"test",
			"--json",
		]);
		expect(result.submissions).toMatchObject([
			{ kind: "worker", options: { parent: "work-1", inputFile: "work.json" } },
		]);
	},
);

test("spawn without a parent reports the required flag before submission", async () => {
	const result = await invoke(
		["spawn", "worker", "--input-file", "work.json", "--actor", "test", "--json"],
		USAGE_ERROR,
	);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		reason: "commander.missingMandatoryOptionValue",
		message: expect.stringContaining("--parent"),
	});
	expect(result.submissions).toEqual([]);
});

test("stop preserves closure and resolution facts without reporting process completion", async () => {
	const result = await invoke(["stop", request.id, "--actor", "test", "--json"]);
	expect(JSON.parse(result.stdout)).toEqual({
		kind: "request_stopped",
		ok: true,
		repository,
		request: {
			acknowledgment: null,
			closeReason: stopped.closeReason,
			closedAt: stopped.closedAt,
			disposition: stopped.disposition,
			host: stopped.host,
			id: stopped.id,
			identity: stopped.identity,
			labelPublication: stopped.labelPublication,
			needsAttention: stopped.needsAttention,
			resolution: stopped.resolution,
			status: stopped.status,
			supersedes: stopped.supersedes,
		},
	});
});

test("status omits captured prompts while preserving request decisions", async () => {
	const result = await invoke(["status", request.id, "--json"]);
	expect(JSON.parse(result.stdout).request).toEqual(summary);
	expect(result.stdout.length).toBeLessThan(PROMPT.length);
	expect(request.recipe).toMatchObject({ prompt: PROMPT, system_prompt: ROLE });
});

test("explicit JSON status returns both full captured prompt fields", async () => {
	const result = await invoke(["status", request.id, "--include-prompt", "--json"]);
	expect(JSON.parse(result.stdout)).toEqual({
		kind: "request_status",
		response: { state: "missing", responseIds: [] },
		ok: true,
		repository,
		request,
	});
});

test.each([
	{ args: ["status", request.id], expand: false },
	{ args: ["status", request.id, "--include-prompt"], expand: true },
])(
	"human status includes captured prompts only when requested: $expand",
	async ({ args, expand }) => {
		const result = await invoke(args);
		expect(result.stdout.includes(PROMPT)).toBe(expand);
		expect(result.stdout.includes(ROLE)).toBe(expand);
		expect(result.stdout).toContain("Observations may be stale");
	},
);

test("setup forwards tracker selection and actor and returns a concise JSON receipt", async () => {
	const calls: unknown[] = [];
	const result = await invoke(
		["setup", "--repo", "/checkout", "--beads-db", repository.beadsDb, "--actor", "test", "--json"],
		SUCCESS,
		{
			setup: (options) => {
				calls.push(options);
				return Promise.resolve({
					kind: "bee_setup",
					repository,
					preset: "bee-attention",
					recipes: ["/checkout/.bv/recipes.yaml", "/tracker/.bv/recipes.yaml"],
				});
			},
		},
	);
	expect(calls).toEqual([{ repo: "/checkout", beadsDb: repository.beadsDb, actor: "test" }]);
	expect(JSON.parse(result.stdout)).toEqual({
		ok: true,
		kind: "bee_setup",
		repository,
		preset: "bee-attention",
		recipes: ["/checkout/.bv/recipes.yaml", "/tracker/.bv/recipes.yaml"],
	});
});

test("setup reports saved-query failures as a silent-stderr JSON error", async () => {
	const result = await invoke(["setup", "--actor", "test", "--json"], FAILURE, {
		setup: () => Promise.reject(new Error("Query write failed")),
	});
	expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, message: "Query write failed" });
});

async function invoke(
	args: readonly string[],
	exitCode = SUCCESS,
	overrides: Partial<BeeDependencies> = {},
) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const submissions: { kind: string; options: WorkflowSpawnOptions }[] = [];
	const deps: BeeDependencies = {
		setup: unexpected,
		responsePublish: unusedResponseCommand,
		responseGet: unusedResponseCommand,
		responseSearch: unusedResponseCommand,
		responseHistory: unusedResponseCommand,
		result: unusedResponseCommand,
		ack: unexpected,
		assess: unexpected,
		attachWorkflow: workflowResult,
		dispatchStage: () => Promise.resolve({ kind: "spawn_created", request: native }),
		finish: unexpected,
		kinds: unexpected,
		report: unexpected,
		retry: () => Promise.resolve({ kind: "spawn_created", request: native }),
		run: unexpected,
		spawn: (kind, options) => {
			submissions.push({ kind, options });
			return workflowResult().then((result) => ({
				...result,
				workflow: { ...result.workflow, parentId: options.parent },
			}));
		},
		status: () =>
			Promise.resolve({
				kind: "request_status",
				repository,
				request,
				response: { state: "missing", responseIds: [] },
			}),
		stderr: (text) => stderr.push(text),
		stdout: (text) => stdout.push(text),
		stop: () => Promise.resolve({ kind: "request_stopped", repository, request: stopped }),
		...overrides,
	};
	expect(await runBeeCli([...args], deps)).toBe(exitCode);
	expect(stderr).toEqual([]);
	expect(stdout).toHaveLength(SINGLE_DOCUMENT);
	return { stdout: stdout.join(""), submissions };
}

function workflowResult(): ReturnType<BeeDependencies["spawn"]> {
	return Promise.resolve({
		kind: "workflow_spawn_created",
		request: { id: "request-1", identity: "worker" },
		workflow: { runId: "run-1", status: "active" },
	});
}

function unexpected(): never {
	throw new Error("Unexpected CLI dependency");
}

function unusedResponseCommand(): Promise<never> {
	return Promise.reject(new Error("Response command not used by this fixture"));
}
