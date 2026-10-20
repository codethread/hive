/* eslint-disable unicorn/no-null -- A retained cold restart has no original predecessor. */
import type {
	DaemonLifecycle,
	DaemonStatus,
	RestartCheckpoint,
	Stopped,
} from "./daemon-lifecycle.ts";
import { DaemonUnavailableError, requestServer } from "./client.ts";
import { afterAll, expect, test } from "bun:test";
import { beesConfigSchema, daemonStopResponseSchema } from "@hive/shared";
import { memoryTracker, unusedWorkReviewCommands } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated daemon artifacts.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture endpoint paths.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { restartServer } from "./daemon-lifecycle.ts";
import { serve } from "./server.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable socket root.
import { tmpdir } from "node:os";

const ONE = 1;
const POLL_MS = 10_000;
const state = await mkdtemp(join(tmpdir(), "colony-drain-"));
const target = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
const repository = { root: join(state, "repo"), beadsDb: join(state, "repo", "db") };
const store = openStore(state);
store.register(repository);
store.setActivity(repository.root, "awake");
store.close();
const entered = Promise.withResolvers<void>();
const callbackGate = Promise.withResolvers<void>();
const callbackEntered = Promise.withResolvers<void>();
const controller = new AbortController();
let callbackFailure: unknown = null;
const { beads } = memoryTracker();
const { list } = beads;
beads.list = async (scope, selection) => {
	entered.resolve();
	await callbackGate.promise;
	const callback = requestServer(
		target,
		{ kind: "inspect-request", repository, requestId: "fixture-request" },
		controller.signal,
	);
	callbackEntered.resolve();
	try {
		await callback;
	} catch (error) {
		callbackFailure = error;
	}
	return list(scope, selection);
};
await serve(target, beads, {
	loadActivity: () =>
		Promise.resolve({
			state: "awake",
			config: beesConfigSchema.parse({ owner: "ct", humans: ["ct"], formulas: {} }),
		}),
	workReview: unusedWorkReviewCommands(),
});
await entered.promise;
const before = await requestServer(target, { kind: "status" });
if (before.kind !== "status") {
	throw new Error("Expected fixture status");
}
const replacement: DaemonStatus = { ...before, id: "new-lifetime", pid: before.pid + ONE };
const fingerprint = { pid: before.pid, ppid: 1, startTime: 1000, cmd: "fixture" };
const checkpoint: RestartCheckpoint = {
	state: "failed",
	previous: null,
	daemon: before,
	registrations: [{ repository, intent: "awake", attempts: [] }],
	confirmedEffects: ["native_service_submitted", "replacement_observed"],
};
let stopResponse: Promise<Stopped> | null = null;
let stopped = false;
let started = false;
let startBeforeExit = false;
let clock = 0;
const lifecycle: DaemonLifecycle = {
	prepare: () => Promise.resolve(),
	pending: () => Promise.resolve(checkpoint),
	record: () => Promise.resolve(),
	owner: () => Promise.resolve(fingerprint),
	verify: () => Promise.resolve(),
	observe: () => {
		if (stopped) {
			return Promise.resolve("stopped");
		}
		return Promise.resolve("live");
	},
	supervisor: () => ({ kind: "launchd", service: "fixture" }),
	handoff: async () =>
		daemonStopResponseSchema.parse(await Bun.file(join(state, "daemon-handoff.json")).json()),
	request: (_selected, command) => {
		if (command.kind === "stop") {
			stopResponse = receiveStop(command);
			return Promise.reject(
				new DaemonUnavailableError("stop", "transport", new Error("caller lost stop response")),
			);
		}
		if (started) {
			return Promise.resolve(replacement);
		}
		if (stopped) {
			const cause = Object.assign(new Error("stopped"), { code: "ENOENT" });
			return Promise.reject(new DaemonUnavailableError("status", "transport", cause));
		}
		return Promise.resolve(before);
	},
	start: async (_selected, effect) => {
		startBeforeExit = !stopped;
		started = true;
		await effect("native_service_submitted");
		return { kind: "launchd", service: "fixture" };
	},
	now: () => clock,
	pause: async () => {
		clock += POLL_MS;
		callbackGate.resolve();
		await callbackEntered.promise;
		controller.abort(new Error("bounded inspection ended"));
		await stopResponse;
	},
};
const result = await restartServer(target, lifecycle, "replace-retained");
const retained = daemonStopResponseSchema.parse(
	await Bun.file(join(state, "daemon-handoff.json")).json(),
);
afterAll(() => rm(state, { force: true, recursive: true }));

test("aborting an injected inspection lets the draining scheduling pass finish and retain its handoff", () => {
	expect(callbackFailure).toBeInstanceOf(DaemonUnavailableError);
	expect(callbackFailure).toMatchObject({ request: "inspect-request", phase: "transport" });
	expect(retained).toMatchObject({
		id: before.id,
		registrations: [{ repository, intent: "awake" }],
	});
	expect(startBeforeExit).toBe(false);
	expect(result.continuation?.confirmedEffects).toContain("recovery_verified");
});

async function receiveStop(command: {
	kind: "stop";
	expectedId?: string | undefined;
}): Promise<Stopped> {
	const response = await requestServer(target, command);
	if (response.kind !== "stopped") {
		throw new Error("Expected stopped response");
	}
	stopped = true;
	return response;
}
