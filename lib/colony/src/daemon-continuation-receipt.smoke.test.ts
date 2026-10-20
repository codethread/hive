/* eslint-disable unicorn/no-null -- Original cold restart evidence retains its explicit absent predecessor. */
import type { RestartCheckpoint, RestartContinuation, Stopped } from "./daemon-lifecycle.ts";
import { afterAll, expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated receipt files.
import { mkdtemp, rm } from "node:fs/promises";
import { readDaemonHandoff, readPendingRestart, recordRestart } from "./daemon-supervisor.ts";
import { currentProcessFingerprint } from "./processes.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture endpoint paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable receipt root.
import { tmpdir } from "node:os";

const ORIGINAL_COUNT = 1018;
const SECOND_COUNT = 2;
const ABSENT_PID = 2_147_483_647;
const state = await mkdtemp(join(tmpdir(), "colony-continuation-receipt-"));
const target = { state, socket: join(state, "s"), runtimeEntry: "/unused" };
const outgoing = {
	id: "outgoing",
	pid: ABSENT_PID,
	owner: { cmd: "runtime", pid: ABSENT_PID, ppid: 1, startTime: 1000 },
};
const registrations: Stopped["registrations"] = [
	{
		repository: { root: "/one", beadsDb: "/one/db" },
		intent: "awake",
		attempts: Array.from({ length: ORIGINAL_COUNT }, (_unused, index) => ({
			id: `one-${index}`,
			spawnId: `request-${index}`,
			state: "running",
		})),
	},
	{
		repository: { root: "/two", beadsDb: "/two/db" },
		intent: "awake",
		attempts: Array.from({ length: SECOND_COUNT }, (_unused, index) => ({
			id: `two-${index}`,
			spawnId: `second-${index}`,
			state: "running",
		})),
	},
];
const original: RestartCheckpoint = {
	state: "failed",
	previous: null,
	registrations,
	daemon: {
		kind: "status",
		id: outgoing.id,
		pid: outgoing.pid,
		socket: target.socket,
		state,
		colonies: [],
	},
	confirmedEffects: ["idle_service_removed", "native_service_submitted", "replacement_observed"],
};
const handoff: Stopped = { kind: "stopped", id: outgoing.id, registrations };
const evidence = { outgoing, confirmedEffects: ["stop_acknowledged"] };
const phases: RestartContinuation[] = [
	{ ...evidence, phase: "prepared" },
	{
		...evidence,
		phase: "stop_requested",
		stopFailure: { phase: "transport", message: "lost response" },
	},
	{ ...evidence, phase: "drained", handoff },
	{ ...evidence, phase: "start_requested", handoff },
	{ ...evidence, phase: "observed", handoff, daemon: { ...original.daemon!, id: "new", pid: 30 } },
];
const roundtrips: {
	phase: string;
	restored: RestartCheckpoint | undefined;
	checkpoint: RestartCheckpoint;
}[] = [];
/* eslint-disable no-await-in-loop -- Each phase replaces and restores the same receipt file. */
for (const continuation of phases) {
	const checkpoint = { ...original, continuation };
	await recordRestart(target, checkpoint);
	const restored = await readPendingRestart(target);
	roundtrips.push({ phase: continuation.phase, restored, checkpoint });
}
await Bun.write(
	join(state, "daemon.json"),
	JSON.stringify({ id: outgoing.id, socket: target.socket, process: outgoing.owner }),
);
await Bun.write(join(state, "daemon-handoff.json"), JSON.stringify(handoff));
const exactHandoff = await readDaemonHandoff(target, outgoing);
const wrongFingerprint = await readDaemonHandoff(target, {
	...outgoing,
	owner: { ...outgoing.owner, startTime: 999 },
}).catch((error: unknown) => error);
const wrongSocket = await readDaemonHandoff(
	{ ...target, socket: join(state, "other") },
	outgoing,
).catch((error: unknown) => error);
const live = await currentProcessFingerprint();
await Bun.write(
	join(state, "daemon.json"),
	JSON.stringify({ id: outgoing.id, socket: target.socket, process: live }),
);
const liveRefusal = await readDaemonHandoff(target, {
	...outgoing,
	pid: live.pid,
	owner: live,
}).catch((error: unknown) => error);
afterAll(() => rm(state, { force: true, recursive: true }));

test.each(roundtrips)(
	"$phase receipt roundtrips all original evidence and continuation facts #test-444",
	({ restored, checkpoint }) => {
		expect(restored).toEqual(checkpoint);
	},
);

test("native handoff requires the selected socket, exact outgoing fingerprint and verified exit", () => {
	expect(exactHandoff?.id).toBe(outgoing.id);
	expect(wrongFingerprint).toBeInstanceOf(Error);
	expect(wrongSocket).toBeInstanceOf(Error);
	expect(liveRefusal).toBeInstanceOf(Error);
});
