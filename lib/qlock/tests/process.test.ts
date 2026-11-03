/* eslint-disable no-magic-numbers -- Supervision contracts use explicit statuses and durations. */
import { expect, test } from "bun:test";
import type { ExecutionDependencies } from "../src/process.ts";
import { QlockError } from "../src/queue.ts";
import { executeChild } from "../src/process.ts";

const limit = { kind: "timeout", milliseconds: 240_000 } as const;

test("runtime expiry kills the whole group but waits for confirmed exit", async () => {
	const harness = fixture();
	const execution = executeChild(["child"], limit, harness.deps);
	expect(harness.scheduled).toEqual([240_000]);
	harness.expire();
	await Promise.resolve();
	expect(harness.signals).toEqual(["SIGKILL"]);
	expect(harness.unsubscribed).toBe(false);
	harness.exit(137);
	await expect(execution).rejects.toBeInstanceOf(QlockError);
	await expect(execution).rejects.toMatchObject({ reason: "execution_timed_out", exitCode: 124 });
});

test("normal completion preserves child status and cancels the deadline", async () => {
	const harness = fixture();
	const execution = executeChild(["child"], limit, harness.deps);
	harness.exit(23);
	expect(await execution).toBe(23);
	expect(harness.signals).toEqual([]);
	expect(harness.cancelled).toBe(true);
	expect(harness.unsubscribed).toBe(true);
});

test("unlimited execution forwards TERM to the group without scheduling a deadline", async () => {
	const harness = fixture();
	const execution = executeChild(["child"], { kind: "unlimited" }, harness.deps);
	harness.interrupt();
	expect(harness.signals).toEqual(["SIGTERM"]);
	expect(harness.scheduled).toEqual([]);
	harness.exit(143);
	expect(await execution).toBe(143);
	expect(harness.unsubscribed).toBe(true);
});

test("signal failure waits for confirmed group exit before reporting the error", async () => {
	const harness = fixture();
	const child = harness.deps.start(["child"]);
	harness.deps.start = () => ({
		...child,
		signal: () => {
			throw new Error("signal failed");
		},
	});
	const execution = executeChild(["child"], limit, harness.deps);
	harness.expire();
	await Promise.resolve();
	expect(harness.unsubscribed).toBe(false);
	harness.exit(0);
	await expect(execution).rejects.toBeInstanceOf(Error);
	expect(harness.unsubscribed).toBe(true);
});

test("spawn failure leaves no timer or signal subscription", async () => {
	const harness = fixture();
	harness.deps.start = () => {
		throw new Error("spawn failed");
	};
	await expect(executeChild(["missing"], limit, harness.deps)).rejects.toBeInstanceOf(Error);
	expect(harness.scheduled).toEqual([]);
	expect(harness.subscribed).toBe(false);
});

function fixture() {
	const state = {
		signals: [] as NodeJS.Signals[],
		scheduled: [] as number[],
		subscribed: false,
		unsubscribed: false,
		cancelled: false,
		expire: () => {},
		interrupt: () => {},
		exit: (_code: number) => {},
	};
	const exited = Promise.withResolvers<number>();
	state.exit = exited.resolve;
	const deps: ExecutionDependencies = {
		start: () => ({
			exited: exited.promise,
			signal: (signal) => {
				state.signals.push(signal);
			},
		}),
		onInterrupt: (forward) => {
			state.subscribed = true;
			state.interrupt = forward;
			return () => {
				state.unsubscribed = true;
			};
		},
		schedule: (milliseconds, expire) => {
			state.scheduled.push(milliseconds);
			state.expire = expire;
			return () => {
				state.cancelled = true;
			};
		},
	};
	return Object.assign(state, { deps });
}
