import { REFRESH_INTERVAL_MS, createRefreshMachine } from "./src/refresh.ts";
import { SimulatedClock, createActor } from "xstate";
import { expect, test } from "bun:test";

const cycling = fixture();
const visibility = fixture();
const stopped = fixture();
const TWO_CYCLES = 2;
cycling.clock.increment(REFRESH_INTERVAL_MS);
await cycling.finish();

// eslint-disable-next-line max-statements -- Keep a blocked read, settlement and the following interval together.
test("refresh waits after each settled cycle and never overlaps a slow read", () => {
	const { actor, clock, calls } = cycling;
	clock.increment(REFRESH_INTERVAL_MS - 1);
	expect(calls()).toBe(1);
	clock.increment(1);
	clock.increment(REFRESH_INTERVAL_MS * TWO_CYCLES);
	expect(calls()).toBe(TWO_CYCLES);
	actor.stop();
});

// eslint-disable-next-line max-statements -- Visibility changes during a pending read form one lifecycle scenario.
test("hidden views pause polling and resume without overlapping an unfinished read", async () => {
	const { actor, clock, calls, finish } = visibility;
	actor.send({ type: "HIDE" });
	clock.increment(REFRESH_INTERVAL_MS);
	expect(calls()).toBe(0);
	actor.send({ type: "SHOW" });
	expect(calls()).toBe(1);
	actor.send({ type: "HIDE" });
	actor.send({ type: "SHOW" });
	expect(calls()).toBe(1);
	actor.send({ type: "HIDE" });
	await finish();
	actor.send({ type: "SHOW" });
	expect(calls()).toBe(TWO_CYCLES);
	actor.stop();
});

test("unmounting cancels future refreshes even when an earlier read finishes later", async () => {
	const { actor, clock, calls, finish } = stopped;
	clock.increment(REFRESH_INTERVAL_MS);
	actor.stop();
	await finish();
	clock.increment(REFRESH_INTERVAL_MS * TWO_CYCLES);
	expect(calls()).toBe(1);
});

function fixture() {
	const clock = new SimulatedClock();
	let count = 0;
	let pending = Promise.withResolvers<void>();
	const actor = createActor(
		createRefreshMachine(() => {
			count++;
			return pending.promise;
		}),
		{ clock, input: { visible: true } },
	).start();
	return {
		actor,
		clock,
		calls: () => count,
		finish: () => {
			const completion = pending.promise;
			pending.resolve();
			pending = Promise.withResolvers<void>();
			return completion;
		},
	};
}
