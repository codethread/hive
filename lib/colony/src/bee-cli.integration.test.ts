/* eslint-disable unicorn/no-null -- Request fixtures preserve explicit absence in the public output contract. */
import { expect, test } from "bun:test";
import type { BeeDependencies } from "./bee-cli.ts";
import type { RequestView } from "./requests.ts";
import { runBeeCli } from "./bee-cli.ts";

const PROMPT_REPETITIONS = 500;
const SUCCESS = 0;
const SINGLE_DOCUMENT = 1;
const PROMPT = "Captured direction. ".repeat(PROMPT_REPETITIONS);
const ROLE = "Captured role. ".repeat(PROMPT_REPETITIONS);
const repository = { beadsDb: "/fixture/tracker.db", root: "/fixture" };
const request: RequestView = {
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

test.each([{ args: ["spawn", "worker", "task-1"] }, { args: ["retry", "request-0"] }])(
	"$args returns the next-command identifiers without native metadata",
	async ({ args }) => {
		const result = await invoke([...args, "--json"]);
		expect(JSON.parse(result.stdout)).toEqual({
			kind: "spawn_created",
			ok: true,
			request: { assignee: "worker", id: "request-1" },
		});
	},
);

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

test.each([
	{ args: ["status", request.id], expected: summary },
	{ args: ["list"], expected: [summary] },
])(
	"$args omits captured prompts while preserving request decisions",
	async ({ args, expected }) => {
		const result = await invoke([...args, "--json"]);
		const output = JSON.parse(result.stdout);
		expect(output.request ?? output.requests).toEqual(expected);
		expect(result.stdout.length).toBeLessThan(PROMPT.length);
		expect(request.recipe).toMatchObject({ prompt: PROMPT, system_prompt: ROLE });
	},
);

test("explicit JSON status returns both full captured prompt fields", async () => {
	const result = await invoke(["status", request.id, "--include-prompt", "--json"]);
	expect(JSON.parse(result.stdout)).toEqual({
		kind: "request_status",
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

async function invoke(args: readonly string[]) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const deps: BeeDependencies = {
		ack: unexpected,
		assess: unexpected,
		finish: unexpected,
		kinds: unexpected,
		list: () => Promise.resolve({ kind: "request_list", repository, requests: [request] }),
		report: unexpected,
		retry: () => Promise.resolve({ kind: "spawn_created", request: native }),
		run: unexpected,
		spawn: () => Promise.resolve({ kind: "spawn_created", request: native }),
		status: () => Promise.resolve({ kind: "request_status", repository, request }),
		stderr: (text) => stderr.push(text),
		stdout: (text) => stdout.push(text),
		stop: () => Promise.resolve({ kind: "request_stopped", repository, request: stopped }),
	};
	expect(await runBeeCli([...args], deps)).toBe(SUCCESS);
	expect(stderr).toEqual([]);
	expect(stdout).toHaveLength(SINGLE_DOCUMENT);
	return { stdout: stdout.join("") };
}

function unexpected(): never {
	throw new Error("Unexpected CLI dependency");
}
