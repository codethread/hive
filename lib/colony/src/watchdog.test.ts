/* eslint-disable unicorn/no-null -- Checkpoints and public status use explicit nulls. */
import { advanceWatchdog, pollWatchdog, watchdogCheckpointSchema } from "./watchdog.ts";
import { expect, test } from "bun:test";
import type { ColonyStatus } from "@hive/shared";
import type { WatchdogCheckpoint } from "./watchdog.ts";

const START = 1_000_000;
const GRACE_MS = 60_000;
const BEFORE = 1;
const empty = watchdogCheckpointSchema.parse({ failures: [], outage: null });
const repository = { beadsDb: "/tracker.db", root: "/repo" };
const failed: ColonyStatus = {
	attempts: [],
	intent: "awake",
	message: "Dispatch failed",
	policy: null,
	registration: "durable",
	repository,
	state: "failed",
};
const alerted: WatchdogCheckpoint = { failures: [repository], outage: null };

test.each(["awake", "asleep"] as const)("initial %s colony is silent", (state) => {
	const result = advanceWatchdog(
		empty,
		{ colonies: [{ ...failed, state }], kind: "reachable" },
		START,
	);
	expect(result).toEqual({ body: undefined, next: empty });
});

test("failed colony alerts immediately and deduplicates changed diagnostics after restart", () => {
	const first = advanceWatchdog(empty, { colonies: [failed], kind: "reachable" }, START);
	expect(first.body).toContain("Dispatch failed");
	expect(first.body).toContain("/tracker.db");
	// eslint-disable-next-line unicorn/prefer-structured-clone -- Exercise the persisted JSON round trip.
	const restored = watchdogCheckpointSchema.parse(JSON.parse(JSON.stringify(first.next)));
	const repeated = advanceWatchdog(
		restored,
		{ colonies: [{ ...failed, message: "Different failure" }], kind: "reachable" },
		START + GRACE_MS,
	);
	expect(repeated.body).toBeUndefined();
	expect(repeated.next).toEqual(alerted);
});

test.each(["awake", "asleep"] as const)("%s clears a failure once and rearms alerts", (state) => {
	const observation = { colonies: [{ ...failed, state }], kind: "reachable" as const };
	const recovery = advanceWatchdog(alerted, observation, START);
	expect(recovery.body).toContain(`Current state: ${state}`);
	expect(recovery.next).toEqual(empty);
	expect(advanceWatchdog(recovery.next, observation, START).body).toBeUndefined();
	expect(
		advanceWatchdog(recovery.next, { colonies: [failed], kind: "reachable" }, START).body,
	).toContain("Colony failed");
});

test("unavailability waits 60 seconds across restarts and alerts once", () => {
	const observation = { kind: "unavailable" as const };
	const first = advanceWatchdog(alerted, observation, START);
	expect(first.body).toBeUndefined();
	// eslint-disable-next-line unicorn/prefer-structured-clone -- Exercise the persisted JSON round trip.
	const restored = watchdogCheckpointSchema.parse(JSON.parse(JSON.stringify(first.next)));
	expect(advanceWatchdog(restored, observation, START + GRACE_MS - BEFORE).body).toBeUndefined();
	const incident = advanceWatchdog(restored, observation, START + GRACE_MS);
	expect(incident.body).toContain("unavailable");
	expect(incident.next.failures).toEqual([repository]);
	expect(advanceWatchdog(incident.next, observation, START + GRACE_MS).body).toBeUndefined();
});

test("brief unavailability clears silently and resets the grace period", () => {
	const outage = advanceWatchdog(empty, { kind: "unavailable" }, START);
	const recovery = advanceWatchdog(outage.next, { colonies: [], kind: "reachable" }, START);
	expect(recovery).toEqual({ body: undefined, next: empty });
	const nextOutage = advanceWatchdog(recovery.next, { kind: "unavailable" }, START + GRACE_MS);
	expect(nextOutage.body).toBeUndefined();
	expect(nextOutage.next.outage?.since).toBe(START + GRACE_MS);
});

test("transport recovery does not clear colony failures or report missing registrations healthy", () => {
	const previous: WatchdogCheckpoint = {
		failures: [repository],
		outage: { delivered: true, since: START },
	};
	const recovered = advanceWatchdog(previous, { colonies: [], kind: "reachable" }, START);
	expect(recovered.body).toBe("Colony daemon reachable again.");
	expect(recovered.next).toEqual(alerted);
	const stillFailed = advanceWatchdog(
		recovered.next,
		{ colonies: [failed], kind: "reachable" },
		START,
	);
	expect(stillFailed.body).toBeUndefined();
});

test("daemon recovery still reports newly failed colonies, keyed by both repository and tracker", () => {
	const otherTracker = { ...repository, beadsDb: "/other.db" };
	const otherRoot = { ...repository, root: "/other" };
	const result = advanceWatchdog(
		{ failures: [repository], outage: { delivered: true, since: START } },
		{
			colonies: [
				failed,
				{ ...failed, repository: otherTracker },
				{ ...failed, repository: otherRoot },
			],
			kind: "reachable",
		},
		START,
	);
	expect(result.body).toContain("reachable again");
	expect(result.body).toContain("/other.db");
	expect(result.body).toContain("/other (");
	expect(result.next.failures).toEqual([repository, otherTracker, otherRoot]);
});

test("poll delivers before saving and stays silent with the restored checkpoint", async () => {
	const effects: string[] = [];
	let saved = empty;
	const io = {
		notify: () => {
			effects.push("notify");
			return Promise.resolve();
		},
		now: () => START,
		observe: () => Promise.resolve({ colonies: [failed], kind: "reachable" as const }),
		save: (next: WatchdogCheckpoint) => {
			effects.push("save");
			saved = next;
			return Promise.resolve();
		},
	};
	await pollWatchdog(empty, io);
	expect(effects).toEqual(["notify", "save"]);
	await pollWatchdog(saved, io);
	expect(effects).toEqual(["notify", "save"]);
});

test("notification failure propagates without marking the incident delivered", async () => {
	let saved = false;
	await expect(
		pollWatchdog(empty, {
			notify: () => Promise.reject(new Error("Delivery failed")),
			now: () => START,
			observe: () => Promise.resolve({ colonies: [failed], kind: "reachable" }),
			save: () => {
				saved = true;
				return Promise.resolve();
			},
		}),
	).rejects.toBeInstanceOf(Error);
	expect(saved).toBe(false);
});

test("poll persists outage onset before an alert is due", async () => {
	let saved = empty;
	let notified = false;
	await pollWatchdog(empty, {
		notify: () => {
			notified = true;
			return Promise.resolve();
		},
		now: () => START,
		observe: () => Promise.resolve({ kind: "unavailable" }),
		save: (next) => {
			saved = next;
			return Promise.resolve();
		},
	});
	expect(saved.outage).toEqual({ delivered: false, since: START });
	expect(notified).toBe(false);
});
