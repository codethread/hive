import { DaemonRequestError, DaemonUnavailableError, requestServer } from "./client.ts";
import { afterAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated protocol fixture state.
import { mkdtemp, rm } from "node:fs/promises";
import { DaemonLifecycleError } from "./daemon-lifecycle.ts";
import { colonyRequestSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture endpoint paths.
import { join } from "node:path";
import { reportFailure } from "./cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable socket root.
import { tmpdir } from "node:os";

const FIRST = 0;
const RECOVER_INDEX = 1;
const ONE = 1;
const state = await mkdtemp(join(tmpdir(), "colony-client-"));
const target = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
const server = Bun.serve({
	unix: target.socket,
	fetch: async (request) => {
		const { kind } = colonyRequestSchema.parse(await request.json());
		if (kind === "recover") {
			return Response.json({ kind: "error", message: "recovery failed" });
		}
		if (kind === "stop") {
			return new Response("incomplete body");
		}
		return Response.json({ kind: "invalid" });
	},
});
const commands = ["status", "recover", "stop"] as const;
const errors = await Promise.all(
	commands.map((kind) => requestServer(target, { kind }).catch((error: unknown) => error)),
);
const unavailable = await requestServer(
	{ ...target, socket: join(state, "absent") },
	{ kind: "status" },
).catch((error: unknown) => error);
await server.stop();
afterAll(() => rm(state, { force: true, recursive: true }));

test.each([
	{ index: 0, request: "status", phase: "decode" },
	{ index: 1, request: "recover", phase: "daemon" },
	{ index: 2, request: "stop", phase: "response" },
])("client attributes $request failures to $phase", ({ index, request, phase }) => {
	expect(errors[index]).toBeInstanceOf(DaemonRequestError);
	expect(errors[index]).toMatchObject({ request, phase });
});

test("transport failures retain their OS cause and request phase", () => {
	expect(unavailable).toBeInstanceOf(DaemonUnavailableError);
	expect(unavailable).toMatchObject({
		request: "status",
		phase: "transport",
		cause: expect.any(Error),
	});
});

test("lifecycle JSON failure exposes request and phase at the public boundary", () => {
	const output: string[] = [];
	const error = new DaemonLifecycleError("incomplete", target, [], {
		cause: errors[RECOVER_INDEX],
	});
	reportFailure(error, true, {
		command: "colony",
		stdout: (text) => output.push(text),
		stderr: () => {
			throw new Error("Unexpected stderr");
		},
	});
	expect(output).toHaveLength(ONE);
	expect(JSON.parse(output[FIRST]!)).toMatchObject({
		ok: false,
		reason: "daemon_lifecycle_incomplete",
		request: "recover",
		phase: "daemon",
	});
});
