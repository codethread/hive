/* eslint-disable unicorn/no-null -- Socket and receipt fixtures preserve explicit missing evidence. */
import type { AttemptDetails, RequestDiagnostic } from "@hive/shared";
import { afterAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Exercise socket and receipt reads in disposable state.
import { mkdtemp, rm } from "node:fs/promises";
import { DaemonUnavailableError } from "./client.ts";
import type { LaunchReceipt } from "./launch.ts";
import { explanationIO } from "./explain-io.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve temporary owned receipt and socket paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Keep the transport independent of any running Colony.
import { tmpdir } from "node:os";
import { z } from "zod";

const state = await mkdtemp(join(tmpdir(), "colony-diagnostic-"));
const OK = 200;
const BAD_REQUEST = 400;
const repository = { beadsDb: "/fixture/beads.db", root: "/fixture" };
const target = { runtimeEntry: "/unused", socket: join(state, "daemon.sock"), state };
const diagnostic: RequestDiagnostic = {
	attempts: [],
	checkpoint: null,
	colony: null,
	kind: "request_diagnostic",
	observedAt: "2026-10-13T00:00:00Z",
	repository,
	reservations: [],
};
let reply: unknown = diagnostic;
let status = OK;
const commands: unknown[] = [];
const server = Bun.serve({
	fetch: async (request) => {
		commands.push({ body: await request.json(), state: request.headers.get("x-colony-state") });
		return Response.json(reply, { status });
	},
	unix: target.socket,
});
const io = explanationIO(repository, target);
const receiptPath = join(state, "receipt.json");
const launch: LaunchReceipt = {
	attemptNumber: 1,
	beadsDb: repository.beadsDb,
	bucket: repository.root,
	createdAt: diagnostic.observedAt,
	cwd: repository.root,
	directory: state,
	formula: { argv: [], executable: "fixture", headless: [] },
	host: "fixture-host",
	id: "attempt",
	identity: "worker",
	invocation: { argv: [], executable: "fixture" },
	policyRevisionId: null,
	recipe: {
		cwd: null,
		effort: "low",
		harness: "fixture",
		kind: "worker",
		model: "fixture",
		prompt: "",
		system_prompt: "",
	},
	spawnId: "target",
	taskIds: [],
	token: "fixture-token",
};
const attempt: AttemptDetails = {
	attemptNumber: launch.attemptNumber,
	bucket: launch.bucket,
	createdAt: launch.createdAt,
	cwd: launch.cwd,
	harness: launch.recipe.harness,
	id: launch.id,
	identity: launch.identity,
	kind: launch.recipe.kind,
	model: launch.recipe.model,
	paths: {
		receipt: receiptPath,
		stderr: "/unused",
		stdout: "/unused",
		supervisor: "/unused",
		worker: "/unused",
	},
	policyRevisionId: null,
	spawnId: launch.spawnId,
	state: "exited",
	taskIds: [],
};

afterAll(async () => {
	await server.stop(true);
	await rm(state, { force: true, recursive: true });
});

test("diagnostic transport requests one target under the selected daemon state", async () => {
	expect(await io.diagnose("target")).toEqual(diagnostic);
	expect(commands).toEqual([
		{ body: { kind: "diagnose", repository, requestId: "target" }, state },
	]);
});

test("daemon authority errors and malformed scoped responses remain failures", async () => {
	reply = { kind: "error", message: "Selected tracker does not match" };
	status = BAD_REQUEST;
	await expect(io.diagnose("target")).rejects.toBeInstanceOf(Error);
	status = OK;
	reply = { ...diagnostic, reservations: [{ state: "exited" }] };
	await expect(io.diagnose("target")).rejects.toBeInstanceOf(z.ZodError);
});

test("an unavailable diagnostic daemon does not start a server", async () => {
	const absent = explanationIO(repository, { ...target, socket: join(state, "absent.sock") });
	await expect(absent.diagnose("target")).rejects.toBeInstanceOf(DaemonUnavailableError);
});

test.each([
	{ field: "id", value: "other-attempt" },
	{ field: "spawnId", value: "other-request" },
	{ field: "beadsDb", value: "/other.db" },
])("fresh receipt $field mismatch cannot establish process liveness", async ({ field, value }) => {
	await Bun.write(receiptPath, JSON.stringify({ ...launch, [field]: value }));
	await expect(io.observe("target", attempt)).rejects.toBeInstanceOf(Error);
});

test("a terminal attempt without ownership evidence remains unknown on repeated fresh reads", async () => {
	await Bun.write(receiptPath, JSON.stringify(launch));
	await expect(io.observe("target", attempt)).rejects.toBeInstanceOf(Error);
	await Bun.write(receiptPath, JSON.stringify({ ...launch, id: "changed-attempt" }));
	await expect(io.observe("target", attempt)).rejects.toBeInstanceOf(Error);
});
