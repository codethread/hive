/* eslint-disable unicorn/no-null -- Checkpoints and public status use explicit nulls. */
import { advanceWatchdog, pollWatchdog, watchdogCheckpointSchema } from "./watchdog.ts";
import { expect, test } from "bun:test";
import { formatBeadsConflict, isBeadsConflict } from "@hive/shared";
import type { ColonyStatus } from "@hive/shared";
import { CommandError } from "@hive/beads";
import { RequestPublicationError } from "./requests.ts";
import type { WatchdogCheckpoint } from "./watchdog.ts";

const FIRST = 0;
const ONE = 1;
const START = 1_000_000;
const GRACE_MS = 60_000;
const BEFORE = 1;
const COOLDOWN_MS = 1_800_000;
const empty = watchdogCheckpointSchema.parse({ failures: [], lastNotifiedAt: null, outage: null });
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
const alerted: WatchdogCheckpoint = {
	failures: [repository],
	lastNotifiedAt: START,
	outage: null,
};

test.each([false, true])(
	"native Beads conflict reaches watchdog with publication wrapper %j",
	// eslint-disable-next-line max-statements -- One watchdog episode proves classification, delivery and deduplication together.
	async (wrapped) => {
		let error: Error = new CommandError("br sync", {
			code: 6,
			stderr: "",
			stdout: JSON.stringify({ error: { code: "SYNC_CONFLICT", message: "tracker conflict" } }),
		});
		if (wrapped) {
			error = new RequestPublicationError({ requestId: "hv-request", replacementIds: [] }, error);
		}
		expect(isBeadsConflict(error)).toBe(true);
		const message = formatBeadsConflict(error, {
			...repository,
			host: "test-host",
			operation: "Colony dispatch",
		});
		const bodies: string[] = [];
		const io = {
			notify: (body: string) => {
				bodies.push(body);
				return Promise.resolve();
			},
			now: () => START,
			observe: () =>
				Promise.resolve({ colonies: [{ ...failed, message }], kind: "reachable" as const }),
			save: () => Promise.resolve(),
		};
		const checkpoint = await pollWatchdog(empty, io);
		await pollWatchdog(checkpoint, io);
		expect(bodies).toHaveLength(ONE);
		expect(bodies[FIRST]).toContain("Host: test-host");
		expect(bodies[FIRST]).toContain("Tracker: /tracker.db");
		expect(bodies[FIRST]).toContain("SYNC_CONFLICT: tracker conflict");
		expect(bodies[FIRST]).toContain("Action:");
	},
);

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

test.each(["awake", "asleep"] as const)(
	"%s notifies recovery immediately but keeps failures quiet",
	(state) => {
		const observation = { colonies: [{ ...failed, state }], kind: "reachable" as const };
		const recovery = advanceWatchdog(alerted, observation, START);
		expect(recovery.body).toContain(`Current state: ${state}`);
		expect(recovery.next).toEqual({ ...empty, lastNotifiedAt: START });
		expect(advanceWatchdog(recovery.next, observation, START).body).toBeUndefined();
		const relapse = advanceWatchdog(
			recovery.next,
			{ colonies: [failed], kind: "reachable" },
			START,
		);
		expect(relapse.body).toBeUndefined();
		expect(relapse.next.failures).toEqual([]);
		expect(
			advanceWatchdog(relapse.next, { colonies: [failed], kind: "reachable" }, START + COOLDOWN_MS)
				.body,
		).toContain("Colony failed");
	},
);

test("unavailability waits 60 seconds across restarts and alerts once", () => {
	const observation = { kind: "unavailable" as const };
	const first = advanceWatchdog(
		{ ...alerted, lastNotifiedAt: START - COOLDOWN_MS },
		observation,
		START,
	);
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
		lastNotifiedAt: START,
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

test("daemon recovery batches eligible failures, keyed by both repository and tracker", () => {
	const otherTracker = { ...repository, beadsDb: "/other.db" };
	const otherRoot = { ...repository, root: "/other" };
	const result = advanceWatchdog(
		{
			...alerted,
			lastNotifiedAt: START - COOLDOWN_MS,
			outage: { delivered: true, since: START - COOLDOWN_MS },
		},
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

test("new failures wait for the exact cooldown boundary across restarts", () => {
	const other = { ...failed, repository: { ...repository, root: "/other" } };
	const observation = { colonies: [failed, other], kind: "reachable" as const };
	const suppressed = advanceWatchdog(alerted, observation, START + COOLDOWN_MS - BEFORE);
	expect(suppressed.body).toBeUndefined();
	expect(suppressed.next).toEqual(alerted);
	// eslint-disable-next-line unicorn/prefer-structured-clone -- Exercise the persisted JSON round trip.
	const restored = watchdogCheckpointSchema.parse(JSON.parse(JSON.stringify(suppressed.next)));
	const due = advanceWatchdog(restored, observation, START + COOLDOWN_MS);
	expect(due.body).toContain("/other");
	expect(due.next).toEqual({
		failures: [repository, other.repository],
		lastNotifiedAt: START + COOLDOWN_MS,
		outage: null,
	});
	expect(
		advanceWatchdog(due.next, observation, START + COOLDOWN_MS + COOLDOWN_MS).body,
	).toBeUndefined();
});

test("daemon outages share the failure cooldown without losing their grace period", () => {
	const observation = { kind: "unavailable" as const };
	const onset = advanceWatchdog(alerted, observation, START);
	const suppressed = advanceWatchdog(onset.next, observation, START + GRACE_MS);
	expect(suppressed.body).toBeUndefined();
	expect(suppressed.next.outage).toEqual({ delivered: false, since: START });
	expect(
		advanceWatchdog(suppressed.next, observation, START + COOLDOWN_MS - BEFORE).body,
	).toBeUndefined();
	const due = advanceWatchdog(suppressed.next, observation, START + COOLDOWN_MS);
	expect(due.body).toContain("unavailable");
	expect(due.next.outage?.delivered).toBe(true);
});

test("recovery does not sneak new failures through the cooldown and restarts its window", () => {
	const other = { ...failed, repository: { ...repository, root: "/other" } };
	const recovered = advanceWatchdog(
		{ ...alerted, outage: { delivered: true, since: START - GRACE_MS } },
		{ colonies: [{ ...failed, state: "awake" }, other], kind: "reachable" },
		START + GRACE_MS,
	);
	expect(recovered.body).toContain("reachable again");
	expect(recovered.body).toContain("failure cleared");
	expect(recovered.body).not.toContain("/other");
	expect(recovered.next).toEqual({ ...empty, lastNotifiedAt: START + GRACE_MS });
	const observation = { colonies: [other], kind: "reachable" as const };
	expect(advanceWatchdog(recovered.next, observation, START + COOLDOWN_MS).body).toBeUndefined();
	expect(
		advanceWatchdog(recovered.next, observation, START + GRACE_MS + COOLDOWN_MS).body,
	).toContain("/other");
});

test("failure cleared during cooldown is not sent later as a stale alert", () => {
	const previous = { ...empty, lastNotifiedAt: START };
	const suppressed = advanceWatchdog(previous, { colonies: [failed], kind: "reachable" }, START);
	const recovered = advanceWatchdog(
		suppressed.next,
		{ colonies: [{ ...failed, state: "awake" }], kind: "reachable" },
		START + COOLDOWN_MS,
	);
	expect(recovered).toEqual({ body: undefined, next: previous });
});

test("poll delivers before saving and stays silent with the restored checkpoint", async () => {
	const effects: string[] = [];
	let saved = empty;
	let now = START;
	const io = {
		notify: () => {
			effects.push("notify");
			now += GRACE_MS;
			return Promise.resolve();
		},
		now: () => now,
		observe: () => Promise.resolve({ colonies: [failed], kind: "reachable" as const }),
		save: (next: WatchdogCheckpoint) => {
			effects.push("save");
			saved = next;
			return Promise.resolve();
		},
	};
	await pollWatchdog(empty, io);
	expect(effects).toEqual(["notify", "save"]);
	expect(saved.lastNotifiedAt).toBe(START + GRACE_MS);
	await pollWatchdog(saved, io);
	expect(effects).toEqual(["notify", "save"]);
});

test.each([
	{
		name: "failure",
		previous: empty,
		state: "failed",
	},
	{
		name: "recovery",
		previous: alerted,
		state: "awake",
	},
])(
	"$name notification failure propagates without consuming delivery state",
	async ({ previous, state }) => {
		let saved = false;
		await expect(
			pollWatchdog(previous, {
				notify: () => Promise.reject(new Error("Delivery failed")),
				now: () => START,
				observe: () => Promise.resolve({ colonies: [{ ...failed, state }], kind: "reachable" }),
				save: () => {
					saved = true;
					return Promise.resolve();
				},
			}),
		).rejects.toBeInstanceOf(Error);
		expect(saved).toBe(false);
	},
);

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
