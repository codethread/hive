import { afterAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Create and remove isolated restart receipt state.
import { mkdtemp, rm } from "node:fs/promises";
import { readPendingRestart, recordRestart } from "./daemon-supervisor.ts";
import type { RestartCheckpoint } from "./daemon-lifecycle.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve receipt and socket paths inside the fixture directory.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Allocate receipts in the OS temporary directory.
import { tmpdir } from "node:os";

const state = await mkdtemp(join(tmpdir(), "colony-restart-receipt-"));
const target = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
const checkpoint: RestartCheckpoint = {
	state: "failed",
	previous: { id: "old", pid: 10, owner: { cmd: "runtime", pid: 10, ppid: 1, startTime: 1000 } },
	daemon: {
		kind: "status",
		id: "replacement",
		pid: 20,
		state,
		socket: target.socket,
		colonies: [],
	},
	registrations: [
		{
			repository: { root: "/one", beadsDb: "/one/db" },
			intent: "awake",
			attempts: [{ id: "running", spawnId: "request-one", state: "running" }],
		},
		{
			repository: { root: "/two", beadsDb: "/two/db" },
			intent: "asleep",
			attempts: [{ id: "finished", spawnId: "request-two", state: "exited" }],
		},
	],
	confirmedEffects: ["idle_service_removed", "native_service_submitted", "replacement_observed"],
};
await recordRestart(target, checkpoint);
const restored = await readPendingRestart(target);
const wrongSocket = await readPendingRestart({ ...target, socket: join(state, "other") }).catch(
	(error: unknown) => error,
);
await Bun.write(
	join(state, "restart.json"),
	JSON.stringify({ ...checkpoint, target: { state: "/other", socket: target.socket } }),
);
const wrongState = await readPendingRestart(target).catch((error: unknown) => error);
await recordRestart(target, { ...checkpoint, state: "done" });
const complete = await readPendingRestart(target);
afterAll(() => rm(state, { force: true, recursive: true }));

test("unfinished restart restores the exact identity, complete original manifest and effects", () => {
	expect(restored).toEqual(checkpoint);
});

test("restart receipts reject selected socket and state mismatches", () => {
	expect(wrongSocket).toBeInstanceOf(Error);
	expect(wrongState).toBeInstanceOf(Error);
});

test("completed restart does not remain pending", () => {
	expect(complete).toBeUndefined();
});
