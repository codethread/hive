/* eslint-disable unicorn/no-null -- Protocol fixtures preserve explicit missing policy and previous lifetime. */
import type { DaemonLifecycle, DaemonStatus } from "./daemon-lifecycle.ts";
import { DaemonLifecycleError, requestLazyServer, restartServer } from "./daemon-lifecycle.ts";
import { expect, mock, test } from "bun:test";
import { DaemonUnavailableError } from "./client.ts";

const FIRST = 0;
const DEADLINE = 10_000;
const target = { runtimeEntry: "/runtime", socket: "/state/colony.sock", state: "/state" };
const repository = { root: "/repo", beadsDb: "/repo/tracker.db" };
const old = { cmd: "runtime", pid: 10, ppid: 1, startTime: 1000 };
const supervisor = { kind: "launchd" as const, service: "gui/501/dev.hive.colony.fixture" };
const colony = {
	attempts: [{ id: "attempt", spawnId: "spawn", state: "running" as const }],
	intent: "awake" as const,
	policy: null,
	registration: "durable" as const,
	repository,
	state: "awake" as const,
};
const before: DaemonStatus = {
	colonies: [colony],
	id: "old",
	kind: "status",
	pid: old.pid,
	socket: target.socket,
	state: target.state,
};
const after: DaemonStatus = { ...before, id: "new", pid: 20 };

// The fake uses the same injected service shape as the native CLI boundary.
function fixture() {
	let clock = 0;
	const effects: string[] = [];
	const deps: DaemonLifecycle = {
		prepare: () => Promise.resolve(),
		// eslint-disable-next-line unicorn/no-useless-undefined -- Optional observation, distinct from a void operation.
		handoff: () => Promise.resolve(undefined),
		// eslint-disable-next-line unicorn/no-useless-undefined -- Optional prior handoff, distinct from a void operation.
		pending: () => Promise.resolve(undefined),
		record: mock(() => Promise.resolve()),
		request: (_target, request) => {
			if (request.kind === "stop") {
				return Promise.resolve({
					kind: "stopped",
					id: before.id,
					registrations: [{ repository, intent: "awake", attempts: colony.attempts }],
				});
			}
			if (request.kind === "recover") {
				return Promise.resolve(after);
			}
			if (effects.includes("submitted")) {
				return Promise.resolve(after);
			}
			return Promise.resolve(before);
		},
		owner: () => Promise.resolve(old),
		observe: () => Promise.resolve("stopped"),
		start: async (_target, effect) => {
			effects.push("submitted");
			await effect("native_service_submitted");
			return supervisor;
		},
		verify: () => Promise.resolve(),
		now: () => clock,
		pause: () => {
			clock += DEADLINE;
			return Promise.resolve();
		},
	};
	return { deps, effects };
}

test("an acknowledged stop with a live daemon never removes its service", async () => {
	const { deps, effects } = fixture();
	deps.observe = () => Promise.resolve("live");
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(effects).toEqual([]);
});

const recoveryCases: { name: string; colonies: DaemonStatus["colonies"] }[] = [
	{ name: "missing registration", colonies: [] },
	{
		name: "failed first pass",
		colonies: [{ ...colony, state: "failed" as const, message: "reconciliation failed" }],
	},
	{ name: "lost survivor", colonies: [{ ...colony, attempts: [] }] },
	{
		name: "duplicate survivor launch",
		colonies: [
			{
				...colony,
				attempts: [...colony.attempts, { ...colony.attempts[FIRST]!, id: "duplicate" }],
			},
		],
	},
];

test.each(recoveryCases)("restart rejects $name after readiness", async ({ colonies }) => {
	const { deps } = fixture();
	const { request } = deps;
	deps.request = (selected, command) => {
		if (command.kind === "recover") {
			return Promise.resolve({ ...after, colonies: [...colonies] });
		}
		return request(selected, command);
	};
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
});

test("failed native startup reports confirmed effects without a fallback launch", async () => {
	const { deps } = fixture();
	const cause = Object.assign(new Error("Missing socket"), { code: "ENOENT" });
	deps.request = () => Promise.reject(new DaemonUnavailableError("unavailable", { cause }));
	deps.start = async (_target, effect) => {
		await effect("native_service_submitted");
		throw new Error("readiness failed");
	};
	try {
		await requestLazyServer(target, { kind: "add", repository }, deps);
		throw new Error("Expected lifecycle failure");
	} catch (error) {
		expect(error).toBeInstanceOf(DaemonLifecycleError);
		expect((error as DaemonLifecycleError).confirmedEffects).toEqual(["native_service_submitted"]);
	}
});

test("an unfinished recovery manifest is preserved before another restart can stop anything", async () => {
	const { deps, effects } = fixture();
	deps.pending = () =>
		Promise.resolve([{ repository, intent: "awake", attempts: colony.attempts }]);
	deps.request = () => Promise.resolve({ ...after, colonies: [] });
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).not.toHaveBeenCalled();
	expect(effects).toEqual([]);
});
