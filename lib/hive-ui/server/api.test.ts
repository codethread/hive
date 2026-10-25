import { expect, test } from "bun:test";
import { workflowSimulationRequestSchema, workflowSimulationSchema } from "@hive/shared";
import type { WorkflowControl } from "@hive/shared";
import { api } from "./api.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";
import { createWorkflowTools } from "./workflow.ts";
import { workflowOutcomeSchema } from "../contracts.ts";

const HTTP = { ok: 200, badRequest: 400, missing: 404, readOnly: 405, unavailable: 503 };
const selected = {
	...colony,
	id: "selected",
	root: "/selected/repository",
	beadsDb: "/selected/tracker.db",
};
const beads = createMemoryBeads();
const scope = { cwd: selected.root, db: selected.beadsDb, actor: "fixture" };
const run = await beads.create(scope, { title: "Workflow run" });
const visit = await beads.create(scope, { title: "Workflow visit", parent: run.id });
const system = await beads.create(scope, {
	title: "Checkpoint",
	labels: ["system", "busybee-checkpoint"],
	description: JSON.stringify({
		formatVersion: 2,
		id: run.id,
		created: [{ bead: visit.id, scope: "visit" }],
		lock: null,
		managedExecution: "managed",
		results: {},
		completions: {},
		settlement: null,
	}),
});
await beads.dep.add(scope, run.id, system.id, "related");
await beads.create(
	{ cwd: colony.root, db: colony.beadsDb, actor: "fixture" },
	{
		title: "Other endpoint checkpoint",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify({ id: "wrong-run", created: [{ bead: visit.id }] }),
	},
);
const input = workflowSimulationRequestSchema.parse({
	checkpoint: "checkpoint",
	savedAt: "saved",
	definitionHash: "definition",
	actorId: "root",
	start: { kind: "saved" },
	events: [{ node: "flow.work", command: "next", data: { evidence: "route" } }],
});
const simulation = workflowSimulationSchema.parse({
	formatVersion: 1,
	runId: run.id,
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
const route = `/api/colonies/${selected.id}/workflow/${visit.id}/simulate`;
const invalidRequests = [
	{ name: "GET simulation", method: "GET", path: route, body: "", status: HTTP.readOnly },
	{ name: "PUT simulation", method: "PUT", path: route, body: "{}", status: HTTP.readOnly },
	{
		name: "POST preview",
		method: "POST",
		path: route.replace("/simulate", ""),
		body: "{}",
		status: HTTP.readOnly,
	},
	{ name: "malformed JSON", method: "POST", path: route, body: "{", status: HTTP.badRequest },
	{ name: "invalid schema", method: "POST", path: route, body: "{}", status: HTTP.badRequest },
	{
		name: "browser-supplied repository",
		method: "POST",
		path: route,
		body: JSON.stringify({ ...input, repo: "/browser/repo" }),
		status: HTTP.badRequest,
	},
	{
		name: "browser-supplied database",
		method: "POST",
		path: route,
		body: JSON.stringify({ ...input, beadsDb: "/browser/tracker.db" }),
		status: HTTP.badRequest,
	},
	{
		name: "unknown colony",
		method: "POST",
		path: route.replace(selected.id, "unknown"),
		body: JSON.stringify(input),
		status: HTTP.missing,
	},
	{
		name: "nonworkflow simulation route",
		method: "POST",
		path: route.replace("/workflow/", "/beads/"),
		body: JSON.stringify(input),
		status: HTTP.missing,
	},
	{
		name: "nonlocal host",
		method: "POST",
		path: route,
		body: JSON.stringify(input),
		status: HTTP.badRequest,
		hostname: "untrusted.example",
	},
];

// eslint-disable-next-line max-statements -- Verify dispatch, response and correlated telemetry for one HTTP request.

test.each(invalidRequests)(
	"simulation HTTP route rejects $name before dispatch #test-543",
	async (entry) => {
		const { calls, samples, dependencies } = fixture();
		const response = await api(httpRequest(entry), dependencies);
		expect(response.status).toBe(entry.status);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toBe("application/json");
		const body: unknown = await response.json();
		expect(body).toEqual({ message: expect.any(String) as unknown });
		expect(calls).toEqual([]);
		expect(samples.pop()).toMatchObject({
			status: entry.status,
			failure: expect.any(String) as unknown,
			operation: entry.path,
			requestId: response.headers.get("x-request-id"),
			scope: "server",
		});
	},
);

test("simulation HTTP route reports workflow adapter failures as unavailable #test-627", async () => {
	const { dependencies, samples } = fixture();
	dependencies.workflow = createWorkflowTools(() =>
		Promise.reject(new Error("Workflow unavailable")),
	);
	const response = await api(
		httpRequest({ path: route, method: "POST", body: JSON.stringify(input) }),
		dependencies,
	);
	expect(response.status).toBe(HTTP.unavailable);
	expect(await response.json()).toEqual({ message: "Workflow unavailable" });
	expect(samples.pop()).toMatchObject({
		status: HTTP.unavailable,
		failure: "Workflow unavailable",
	});
});

test.each(["checkpoint", "preview"] as const)(
	"workflow GET %s uses the production adapter with the selected owning run #test-544",
	async (operation) => {
		const { calls, dependencies } = fixture();
		const checkpoint = { runId: run.id, checkpoint: "checkpoint", savedAt: "saved" };
		const inspection = {
			...checkpoint,
			formatVersion: 1,
			title: "Workflow",
			definition: {
				label: "example",
				savedHash: "source",
				currentHash: "source",
				sourceMatch: "exact",
			},
			actors: [simulation.actor],
		};
		const value = { checkpoint, preview: inspection }[operation];
		dependencies.workflow = createWorkflowTools((argv, cwd) => {
			calls.push({ argv, cwd });
			const kind = { checkpoint: "workflow_checkpoint", preview: "workflow_inspection" }[operation];
			return Promise.resolve(JSON.stringify({ ok: true, kind, ...value }));
		});
		const path = route.replace("/simulate", "");
		const response = await api(
			httpRequest({
				path: `${path}?checkpointOnly=${operation === "checkpoint"}`,
				method: "GET",
				body: "",
			}),
			dependencies,
		);
		expect(response.status).toBe(HTTP.ok);
		expect(await response.json()).toEqual(value);
		expect(calls).toEqual([
			{
				cwd: selected.root,
				argv: [
					"busybee",
					"--repo",
					selected.root,
					"--db",
					selected.beadsDb,
					"system",
					operation,
					run.id,
					"--json",
				],
			},
		]);
	},
);

test.each(["pending", "requested", "confirmed", "reopened", "unauthorized"] as const)(
	"outcome-only read exposes %s system/native projection without loading a definition",
	// eslint-disable-next-line max-statements -- Exercise directive/projection variants through the real HTTP boundary.
	async (variant) => {
		const current = await outcomeFixture();
		const { native, checkpoint, control, dependencies } = current;
		if (variant !== "pending" && variant !== "requested") {
			await native.close(scope, current.runId, { reason: "Readable completion" });
		}
		const task = await native.show(scope, current.runId);
		if (variant !== "pending" && variant !== "unauthorized") {
			const fields = { scope: "run", outcome: "succeeded", reason: "Readable completion" } as const;
			// eslint-disable-next-line unicorn/prefer-ternary -- Keep the two directive variants explicit.
			if (variant === "requested") {
				control.completions[current.runId] = { ...fields, state: "requested" };
			} else {
				control.completions[current.runId] = {
					...fields,
					state: "confirmed",
					closedAt: task.closed_at!,
				};
			}
		}
		await native.update(scope, [checkpoint], { description: JSON.stringify(control) });
		if (variant === "reopened") {
			await native.update(scope, [current.runId], { status: "open" });
		}
		const response = await api(
			httpRequest({ path: current.path, method: "GET", body: "" }),
			dependencies,
		);
		expect(response.status).toBe(HTTP.ok);
		const result = workflowOutcomeSchema.parse(await response.json());
		const checkpointRecord = await native.show(scope, checkpoint);
		expect(result).toMatchObject({
			runId: current.runId,
			checkpoint,
			savedAt: checkpointRecord.updated_at,
		});
		const currentTask = await native.show(scope, current.runId);
		expect(result.updatedAt).toBe(currentTask.updated_at);
		expect(result.completion).toEqual(control.completions[current.runId] ?? null);
		if (variant === "confirmed") {
			expect(result.outcome).toMatchObject({ kind: "terminal", fact: { outcome: "succeeded" } });
			expect(result.labelsCurrent).toBe(false);
		} else if (variant === "pending") {
			expect(result.outcome).toEqual({ kind: "pending" });
		} else {
			const reasons = {
				requested: "unconfirmed_completion",
				reopened: "native_open",
				unauthorized: "unauthorized_closure",
			};
			expect(result.outcome).toMatchObject({ kind: "mismatch", reason: reasons[variant] });
		}
	},
);

// eslint-disable-next-line max-statements -- Compare independent native and system revisions around a diagram failure.
test("outcome freshness follows system updates independently of native task and failed preview", async () => {
	const current = await outcomeFixture();
	const read = async () => {
		const response = await api(
			httpRequest({ path: current.path, method: "GET", body: "" }),
			current.dependencies,
		);
		return workflowOutcomeSchema.parse(await response.json());
	};
	const before = await read();
	const preview = await api(
		httpRequest({ path: current.path.replace("?outcomeOnly=true", ""), method: "GET", body: "" }),
		current.dependencies,
	);
	expect(preview.status).toBe(HTTP.unavailable);
	await current.native.update(scope, [current.checkpoint], {
		description: JSON.stringify({ ...current.control, lock: { owner: "writer", pid: 123 } }),
	});
	const after = await read();
	expect(after.checkpoint).toBe(before.checkpoint);
	expect(after.savedAt).not.toBe(before.savedAt);
	expect(after.updatedAt).toBe(before.updatedAt);
	expect(after.outcome).toEqual({ kind: "pending" });
});

test("outcome-only rejects unsupported format with an explicit adoption diagnosis", async () => {
	const current = await outcomeFixture();
	await current.native.update(scope, [current.checkpoint], {
		description: JSON.stringify({ ...current.control, formatVersion: 1 }),
	});
	const response = await api(
		httpRequest({ path: current.path, method: "GET", body: "" }),
		current.dependencies,
	);
	expect(response.status).toBe(HTTP.unavailable);
	expect(await response.json()).toEqual({
		message: expect.stringContaining("unsupported format") as unknown,
	});
});

async function outcomeFixture() {
	const native = createMemoryBeads();
	const created = await native.create(scope, { title: "Outcome-only run" });
	const control: WorkflowControl = {
		formatVersion: 2,
		id: created.id,
		created: [],
		lock: null,
		managedExecution: "managed",
		results: {},
		completions: {},
		settlement: null,
	};
	const checkpoint = await native.create(scope, {
		title: "System authority",
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify(control),
	});
	await native.dep.add(scope, created.id, checkpoint.id, "related");
	const { dependencies } = fixture();
	return {
		native,
		checkpoint: checkpoint.id,
		runId: created.id,
		control,
		path: `/api/colonies/${selected.id}/workflow/${created.id}?outcomeOnly=true`,
		dependencies: {
			...dependencies,
			beads: native,
			workflow: createWorkflowTools(() => {
				throw new Error("Definition unavailable");
			}),
		},
	};
}

function fixture() {
	const calls: { argv: string[]; cwd: string }[] = [];
	const samples: object[] = [];
	return {
		calls,
		samples,
		dependencies: {
			beads,
			colonies: [colony, selected],
			host: "127.0.0.1",
			data: createBoardData(() => {
				throw new Error("Graph must remain lazy");
			}),
			log: (sample: object) => {
				samples.push(sample);
				return Promise.resolve();
			},
			workflow: createWorkflowTools((argv, cwd) => {
				calls.push({ argv, cwd });
				return Promise.resolve(
					JSON.stringify({ ok: true, kind: "workflow_simulation", ...simulation }),
				);
			}),
		},
	};
}

function httpRequest({
	path,
	method,
	body,
	hostname = "127.0.0.1",
}: {
	path: string;
	method: string;
	body: string;
	hostname?: string;
}): Request {
	if (method === "GET") {
		return new Request(`http://${hostname}${path}`);
	}
	return new Request(`http://${hostname}${path}`, { method, body });
}
