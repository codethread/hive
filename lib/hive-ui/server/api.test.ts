import { expect, test } from "bun:test";
import { workflowSimulationRequestSchema, workflowSimulationSchema } from "@hive/shared";
import { api } from "./api.ts";
import { colony } from "../src/stories/fixtures.ts";
import { createBoardData } from "./data.ts";
import { createMemoryBeads } from "@hive/beads";
import { createWorkflowTools } from "./workflow.ts";

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
await beads.create(scope, {
	title: "Checkpoint",
	labels: ["system", "busybee-checkpoint"],
	description: JSON.stringify({ id: run.id, created: [{ bead: visit.id }] }),
});
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

// Warm lazy boundary schemas and platform Request/Response setup outside measured tests.
await api(
	httpRequest({ path: route, method: "POST", body: JSON.stringify(input) }),
	fixture().dependencies,
);

// eslint-disable-next-line max-statements -- Verify dispatch, response and correlated telemetry for one HTTP request.
test("simulation HTTP route parses replay and selects the endpoint and owning run", async () => {
	const { calls, samples, dependencies } = fixture();
	const response = await api(
		httpRequest({
			path: `${route}?repo=/browser/repo&beadsDb=/browser/tracker.db`,
			method: "POST",
			body: JSON.stringify(input),
		}),
		dependencies,
	);
	expect(response.status).toBe(HTTP.ok);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("content-type")).toBe("application/json");
	const text = await response.text();
	expect(JSON.parse(text)).toEqual(simulation);
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
				"simulate",
				run.id,
				"--request",
				JSON.stringify(input),
				"--json",
			],
		},
	]);
	expect(samples.pop()).toEqual({
		bytes: new TextEncoder().encode(text).length,
		failure: undefined,
		ms: expect.any(Number) as unknown,
		operation: route,
		requestId: response.headers.get("x-request-id"),
		scope: "server",
		status: HTTP.ok,
	});
	expect(response.headers.get("x-request-id")).toBeString();
});

test.each(invalidRequests)("simulation HTTP route rejects $name before dispatch", async (entry) => {
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
});

test("simulation HTTP route reports workflow adapter failures as unavailable", async () => {
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
	"workflow GET %s uses the production adapter with the selected owning run",
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
