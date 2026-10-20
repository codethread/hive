/* eslint-disable unicorn/no-null -- Protocol fixtures preserve explicit missing policy and previous lifetime. */
import type {
	DaemonLifecycle,
	DaemonStatus,
	RestartCheckpoint,
	Stopped,
} from "./daemon-lifecycle.ts";
import { DaemonLifecycleError, requestLazyServer, restartServer } from "./daemon-lifecycle.ts";
import { expect, mock, test } from "bun:test";
import { DaemonUnavailableError } from "./client.ts";

const FIRST = 0;
const DEADLINE = 10_000;
const NONE = 0;
const ONE = 1;
const TWO = 2;
const DELAYED_RECOVERY_MS = 60_000;
const RECOVERY_DEADLINE_MS = 600_000;
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
		supervisor: () => supervisor,
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
		name: "changed database",
		colonies: [{ ...colony, repository: { ...repository, beadsDb: "/other/db" } }],
	},
	{ name: "changed intent", colonies: [{ ...colony, intent: "asleep" }] },
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
	deps.request = () => Promise.reject(new DaemonUnavailableError("status", "transport", cause));
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
		Promise.resolve({
			state: "failed",
			previous: null,
			daemon: null,
			confirmedEffects: [],
			registrations: [{ repository, intent: "awake", attempts: colony.attempts }],
		});
	deps.request = () => Promise.resolve({ ...after, colonies: [] });
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).not.toHaveBeenCalled();
	expect(effects).toEqual([]);
});

function retained(state: "running" | "failed" = "failed") {
	const registrations: Stopped["registrations"] = [
		{ repository, intent: "awake", attempts: colony.attempts },
	];
	return {
		state,
		previous: { id: before.id, pid: before.pid, owner: old },
		registrations,
		daemon: after,
		confirmedEffects: [
			"stop_requested",
			"stop_acknowledged",
			"old_daemon_exited",
			"native_service_submitted",
			"replacement_observed",
		],
	};
}

test("recovery polls across delayed scheduling passes without another replacement", async () => {
	const { deps, effects } = fixture();
	const { request } = deps;
	let remaining = 6;
	deps.request = (selected, command) => {
		if (command.kind === "recover" && remaining > NONE) {
			remaining -= ONE;
			return Promise.resolve({ ...after, kind: "recovering" });
		}
		return request(selected, command);
	};
	const result = await restartServer(target, deps);
	expect(deps.now()).toBe(DELAYED_RECOVERY_MS);
	expect(result.daemon).toEqual(after);
	expect(result.confirmedEffects.at(-ONE)).toBe("recovery_verified");
	expect(effects).toEqual(["submitted"]);
});

test.each(["running", "failed"] as const)(
	"%s restart receipt resumes the observed replacement with the original manifest",
	// eslint-disable-next-line max-statements -- Cover both repositories, natural completion and retained effects.
	async (state) => {
		const { deps } = fixture();
		const checkpoint = retained(state);
		const completed = {
			...colony,
			repository: { root: "/second", beadsDb: "/second/db" },
			intent: "asleep" as const,
			state: "asleep" as const,
			attempts: [{ id: "completed", spawnId: "second-spawn", state: "exited" as const }],
		};
		checkpoint.registrations.push({
			repository: completed.repository,
			intent: completed.intent,
			attempts: completed.attempts,
		});
		const recovered = {
			...after,
			colonies: [
				{
					...colony,
					attempts: colony.attempts.map((attempt) => ({ ...attempt, state: "exited" as const })),
				},
				completed,
			],
		};
		deps.pending = () => Promise.resolve(checkpoint);
		deps.request = mock(() => Promise.resolve(recovered));
		deps.start = mock(deps.start);
		deps.verify = mock(deps.verify);
		const result = await restartServer(target, deps);
		expect(deps.start).not.toHaveBeenCalled();
		expect(deps.request).toHaveBeenCalledTimes(TWO);
		expect(deps.verify).toHaveBeenCalledTimes(TWO);
		expect(result.previous).toEqual({ id: before.id, pid: before.pid });
		expect(result.confirmedEffects).toEqual([
			...checkpoint.confirmedEffects,
			"replacement_ready",
			"recovery_verified",
		]);
		expect(deps.record).toHaveBeenLastCalledWith(
			target,
			expect.objectContaining({ state: "done", registrations: checkpoint.registrations }),
		);
	},
);

// eslint-disable-next-line max-statements -- Keep interruption, retry and lifecycle effect counts in one scenario.
test("interruption after replacement observation retains the receipt and retries without stopping again", async () => {
	const { deps, effects } = fixture();
	const { request } = deps;
	const saved: { checkpoint?: RestartCheckpoint } = {};
	let interrupted = true;
	let stops = 0;
	deps.record = (_selected, checkpoint) => {
		saved.checkpoint = structuredClone(checkpoint);
		return Promise.resolve();
	};
	deps.pending = () => Promise.resolve(saved.checkpoint);
	deps.request = (selected, command) => {
		if (command.kind === "stop") {
			stops += ONE;
		}
		if (command.kind === "recover" && interrupted) {
			return Promise.reject(
				new DaemonUnavailableError("recover", "transport", new Error("caller interrupted")),
			);
		}
		return request(selected, command);
	};
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(saved.checkpoint).toMatchObject({ state: "failed", daemon: after });
	interrupted = false;
	const result = await restartServer(target, deps);
	expect(stops).toBe(ONE);
	expect(effects).toEqual(["submitted"]);
	expect(
		result.confirmedEffects.filter((effect) => effect === "replacement_observed"),
	).toHaveLength(ONE);
	expect(saved.checkpoint).toMatchObject({
		state: "done",
		registrations: [{ repository, attempts: colony.attempts }],
	});
});

test.each([
	{ name: "lifetime", change: { id: "foreign" } },
	{ name: "pid", change: { pid: 999 } },
	{ name: "socket", change: { socket: "/foreign/socket" } },
	{ name: "state", change: { state: "/foreign/state" } },
])(
	"retained replacement rejects $name mismatch without changing its receipt",
	async ({ change }) => {
		const { deps, effects } = fixture();
		deps.pending = () => Promise.resolve(retained());
		deps.request = mock(() => Promise.resolve({ ...after, ...change }));
		await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
		expect(deps.record).not.toHaveBeenCalled();
		expect(deps.request).toHaveBeenCalledTimes(ONE);
		expect(effects).toEqual([]);
	},
);

test("retained replacement requires current independent native ownership before recovery", async () => {
	const { deps } = fixture();
	deps.pending = () => Promise.resolve(retained());
	deps.request = mock(() => Promise.resolve(after));
	deps.verify = () => Promise.reject(new Error("native ownership mismatch"));
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).not.toHaveBeenCalled();
	expect(deps.request).toHaveBeenCalledTimes(ONE);
});

test.each(recoveryCases)(
	"resumed recovery rejects $name and retains the original manifest",
	async ({ colonies }) => {
		const { deps } = fixture();
		deps.pending = () => Promise.resolve(retained());
		deps.request = () => Promise.resolve({ ...after, colonies });
		await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
		expect(deps.record).toHaveBeenLastCalledWith(
			target,
			expect.objectContaining({ state: "failed", registrations: retained().registrations }),
		);
	},
);

test("recovery deadline retains confirmed effects and never reports verification", async () => {
	const { deps, effects } = fixture();
	const checkpoint = retained();
	deps.pending = () => Promise.resolve(checkpoint);
	deps.request = (_selected, command) => {
		if (command.kind === "recover") {
			return Promise.resolve({ ...after, kind: "recovering" });
		}
		return Promise.resolve(after);
	};
	deps.pause = () => {
		deps.now = () => RECOVERY_DEADLINE_MS;
		return Promise.resolve();
	};
	const failure = await restartServer(target, deps).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(DaemonLifecycleError);
	expect((failure as DaemonLifecycleError).confirmedEffects).toEqual(checkpoint.confirmedEffects);
	expect(deps.record).toHaveBeenLastCalledWith(
		target,
		expect.objectContaining({
			state: "failed",
			daemon: after,
			registrations: checkpoint.registrations,
		}),
	);
	expect(effects).toEqual([]);
});

test("a recovery response arriving after the deadline cannot complete restart", async () => {
	const { deps } = fixture();
	deps.pending = () => Promise.resolve(retained());
	deps.request = (_selected, command) => {
		if (command.kind === "recover") {
			deps.now = () => RECOVERY_DEADLINE_MS;
		}
		return Promise.resolve(after);
	};
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).toHaveBeenLastCalledWith(
		target,
		expect.objectContaining({ state: "failed", confirmedEffects: retained().confirmedEffects }),
	);
});

test("an unavailable retained replacement preserves its receipt without attempting startup", async () => {
	const { deps, effects } = fixture();
	deps.pending = () => Promise.resolve(retained());
	const cause = Object.assign(new Error("Missing socket"), { code: "ENOENT" });
	deps.request = () => Promise.reject(new DaemonUnavailableError("status", "transport", cause));
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).not.toHaveBeenCalled();
	expect(effects).toEqual([]);
});

test("replacement identity remains bound while recovery is still pending", async () => {
	const { deps } = fixture();
	deps.pending = () => Promise.resolve(retained());
	deps.request = (_selected, command) => {
		if (command.kind === "recover") {
			return Promise.resolve({ ...after, id: "foreign", kind: "recovering" });
		}
		return Promise.resolve(after);
	};
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.record).toHaveBeenLastCalledWith(
		target,
		expect.objectContaining({ state: "failed", confirmedEffects: retained().confirmedEffects }),
	);
});

test("native preflight failure leaves the working daemon and its service untouched", async () => {
	const { deps, effects } = fixture();
	deps.prepare = () => Promise.reject(new Error("GUI domain unavailable"));
	deps.request = mock(deps.request);
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(deps.request).not.toHaveBeenCalled();
	expect(deps.record).not.toHaveBeenCalled();
	expect(effects).toEqual([]);
});
