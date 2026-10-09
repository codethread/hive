/* eslint-disable no-magic-numbers, unicorn/no-null -- Tests spell out expected IDs, timings and the domain null urgency. */
import {
	QlockError,
	READY_WINDOW_MS,
	advanceQueue,
	emptyQueue,
	enqueue,
	finish,
	reserve,
	ticketById,
} from "../src/queue.ts";
import { expect, test } from "bun:test";

const owner = { pid: 42, command: ["build"], startedAt: 0 };

test("urgency orders unreserved tickets FIFO without preempting a ready head", () => {
	const ready = advanceQueue(enqueue(emptyQueue(), "/first", null), 0, new Set());
	const queue = enqueue(
		enqueue(enqueue(ready, "/ordinary", null), "/urgent-a", "fix"),
		"/urgent-b",
		"fix",
	);
	const advanced = advanceQueue(queue, 1, new Set());
	expect(advanced.tickets.map(({ id }) => id)).toEqual([1, 3, 4, 2]);
	expect(advanced.tickets[0]).toMatchObject({ state: "ready", readyAt: 0 });
	expect(queue.tickets.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
});

test.each([
	{ now: READY_WINDOW_MS - 1, ids: [1, 2], readyAt: 0 },
	{ now: READY_WINDOW_MS, ids: [2], readyAt: READY_WINDOW_MS },
])("ready reservation expiry at $now ms", ({ now, ids, readyAt }) => {
	const ready = advanceQueue(enqueue(emptyQueue(), "/first", null), 0, new Set());
	const advanced = advanceQueue(enqueue(ready, "/second", null), now, new Set());
	expect(advanced.tickets.map(({ id }) => id)).toEqual([...ids]);
	expect(advanced.tickets[0]).toMatchObject({ state: "ready", readyAt });
});

test.each([
	{ live: [42], ids: [1, 2], state: "running" },
	{ live: [], ids: [2], state: "ready" },
])("running owner liveness controls release: $state", ({ live, ids, state }) => {
	const ready = advanceQueue(enqueue(emptyQueue(), "/first", null), 0, new Set());
	const running = reserve(ready, 1, owner);
	const queue = enqueue(running, "/urgent", "fix");
	const advanced = advanceQueue(queue, READY_WINDOW_MS * 10, new Set(live));
	expect(advanced.tickets.map(({ id }) => id)).toEqual([...ids]);
	expect(advanced.tickets[0]?.state).toBe(state);
});

test("only a ready ticket can reserve execution and IDs are not reused", () => {
	const queued = enqueue(emptyQueue(), "/caller", null);
	expect(() => reserve(queued, 1, owner)).toThrow(QlockError);
	const ready = advanceQueue(queued, 0, new Set());
	const running = reserve(ready, 1, owner);
	expect(ticketById(running, 1)).toMatchObject({ state: "running", ...owner });
	expect(() => reserve(running, 1, owner)).toThrow(QlockError);
	const next = enqueue(finish(running, 1), "/next", null);
	expect(next.tickets.map(({ id }) => id)).toEqual([2]);
	expect(() => ticketById(next, 1)).toThrow(QlockError);
});
