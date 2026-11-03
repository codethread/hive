import type { WorkflowSimulation, WorkflowSimulationRequest } from "@hive/shared";
import { expect, test } from "bun:test";
import { sampleLifecycle, sampleWorkflowView } from "../src/stories/workflow-lifecycle-fixture.ts";
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
const input: WorkflowSimulationRequest = {
	checkpoint: "checkpoint",
	savedAt: "saved",
	definitionHash: "definition",
	actorId: "root",
	start: { kind: "saved" },
	events: [{ node: "flow.work", command: "next", data: { evidence: "route" } }],
};
const simulationTemplate: WorkflowSimulation = {
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
};
const requestPath = `/api/colonies/${selected.id}/workflow/visit/simulate`;
const invalidRequests = [
	{ name: "GET simulation", method: "GET", path: requestPath, body: "", status: HTTP.readOnly },
	{ name: "PUT simulation", method: "PUT", path: requestPath, body: "{}", status: HTTP.readOnly },
	{
		name: "POST preview",
		method: "POST",
		path: requestPath.replace("/simulate", ""),
		body: "{}",
		status: HTTP.readOnly,
	},
	{ name: "malformed JSON", method: "POST", path: requestPath, body: "{", status: HTTP.badRequest },
	{
		name: "invalid schema",
		method: "POST",
		path: requestPath,
		body: "{}",
		status: HTTP.badRequest,
	},
	{
		name: "browser-supplied repository",
		method: "POST",
		path: requestPath,
		body: JSON.stringify({ ...input, repo: "/browser/repo" }),
		status: HTTP.badRequest,
	},
	{
		name: "browser-supplied database",
		method: "POST",
		path: requestPath,
		body: JSON.stringify({ ...input, beadsDb: "/browser/tracker.db" }),
		status: HTTP.badRequest,
	},
	{
		name: "unknown colony",
		method: "POST",
		path: requestPath.replace(selected.id, "unknown"),
		body: JSON.stringify(input),
		status: HTTP.missing,
	},
	{
		name: "nonworkflow simulation route",
		method: "POST",
		path: requestPath.replace("/workflow/", "/beads/"),
		body: JSON.stringify(input),
		status: HTTP.missing,
	},
	{
		name: "nonlocal host",
		method: "POST",
		path: requestPath,
		body: JSON.stringify(input),
		status: HTTP.badRequest,
		hostname: "untrusted.example",
	},
];

test.each(invalidRequests)("simulation HTTP route rejects $name before dispatch", async (entry) => {
	const { calls, samples, dependencies, visit } = await fixture();
	const actual = { ...entry, path: entry.path.replace("/visit/", `/${visit.id}/`) };
	const response = await api(httpRequest(actual), dependencies);
	expect(response.status).toBe(entry.status);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("content-type")).toBe("application/json");
	const body: unknown = await response.json();
	expect(body).toEqual({ message: expect.any(String) as unknown });
	expect(calls).toEqual([]);
	expect(samples.pop()).toMatchObject({
		status: entry.status,
		failure: expect.any(String) as unknown,
		operation: actual.path,
		requestId: response.headers.get("x-request-id"),
		scope: "server",
	});
});

test("simulation HTTP route reports workflow adapter failures as unavailable", async () => {
	const { dependencies, samples, route } = await fixture();
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

test.each(["lifecycle", "preview"] as const)(
	"workflow GET %s uses the production adapter with the selected owning run",
	// eslint-disable-next-line max-statements -- Verify selected endpoint, owning run and exact public command together.
	async (operation) => {
		const { calls, dependencies, run, route, simulation } = await fixture();
		const checkpoint = { runId: run.id, checkpoint: "checkpoint", savedAt: "saved" };
		const inspection = {
			...checkpoint,
			formatVersion: 1 as const,
			title: "Workflow",
			definition: {
				label: "example",
				savedHash: "source",
				currentHash: "source",
				sourceMatch: "exact" as const,
			},
			actors: [simulation.actor],
		};
		const value = {
			lifecycle: sampleLifecycle(inspection),
			preview: sampleWorkflowView(inspection),
		}[operation];
		dependencies.workflow = createWorkflowTools((argv, cwd) => {
			calls.push({ argv, cwd });
			const kind = "workflow_lifecycle";
			return Promise.resolve(JSON.stringify({ ok: true, kind, ...value }));
		});
		let expansion: string[] = [];
		if (operation === "preview") {
			expansion = ["--diagram", "--instructions"];
		}
		const path = route.replace("/simulate", "");
		const response = await api(
			httpRequest({
				path: `${path}?lifecycleOnly=${operation === "lifecycle"}`,
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
					"inspect",
					run.id,
					...expansion,
					"--json",
				],
			},
		]);
	},
);

// eslint-disable-next-line max-statements -- Build each complete measured endpoint and native-record fixture.
async function fixture() {
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
	const simulation = { ...simulationTemplate, runId: run.id };
	const route = `/api/colonies/${selected.id}/workflow/${visit.id}/simulate`;
	const calls: { argv: string[]; cwd: string }[] = [];
	const samples: object[] = [];
	return {
		run,
		visit,
		route,
		simulation,
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
