/* eslint-disable unicorn/no-null -- Retained cold-restart evidence explicitly records no predecessor. */
import type {
	DaemonLifecycle,
	DaemonStatus,
	RestartCheckpoint,
	RestartContinuation,
	Stopped,
} from "./daemon-lifecycle.ts";
import { DaemonLifecycleError, restartServer } from "./daemon-lifecycle.ts";
import { expect, test } from "bun:test";
import { DaemonUnavailableError } from "./client.ts";

const ONE = 1;
const NONE = 0;
const POLL_MS = 10_000;
const DEADLINE_MS = 600_000;
const absentSocket = new DaemonUnavailableError(
	"status",
	"transport",
	Object.assign(new Error("absent"), { code: "ENOENT" }),
);
const target = { state: "/state", socket: "/state/socket", runtimeEntry: "/runtime" };
const repository = { root: "/repo", beadsDb: "/repo/db" };
const owner = { pid: 20, ppid: 1, startTime: 1000, cmd: "runtime" };
const originalAttempts = [
	{ id: "original", spawnId: "original-request", state: "running" as const },
];
const added = { id: "intervening", spawnId: "intervening-request", state: "running" as const };
const registrations: Stopped["registrations"] = [
	{ repository, intent: "awake", attempts: originalAttempts },
];
const outgoing: DaemonStatus = {
	kind: "status",
	id: "outgoing",
	pid: owner.pid,
	state: target.state,
	socket: target.socket,
	colonies: [{ ...registrations[NONE]!, state: "awake", policy: null, registration: "durable" }],
};
const handoff: Stopped = {
	kind: "stopped",
	id: outgoing.id,
	registrations: [{ ...registrations[NONE]!, attempts: [...originalAttempts, added] }],
};
const replacement: DaemonStatus = {
	...outgoing,
	id: "replacement",
	pid: 30,
	colonies: [{ ...outgoing.colonies[NONE]!, attempts: [...originalAttempts, added] }],
};
const supervisor = { kind: "launchd" as const, service: "fixture" };
const original: RestartCheckpoint = {
	state: "failed",
	previous: null,
	registrations,
	daemon: outgoing,
	confirmedEffects: ["idle_service_removed", "native_service_submitted", "replacement_observed"],
};

function fixture(continuation?: RestartContinuation) {
	let clock = 0;
	const saved = {
		checkpoint: snapshot({ ...original, continuation }),
	};
	const calls = { stops: 0, starts: 0, recoveries: 0 };
	let current = outgoing;
	const boundaryPhases: string[] = [];
	const deps: DaemonLifecycle = {
		prepare: () => Promise.resolve(),
		pending: () => {
			if (saved.checkpoint.state === "done") {
				// eslint-disable-next-line unicorn/no-useless-undefined -- Completed receipts are not pending work.
				return Promise.resolve(undefined);
			}
			return Promise.resolve(snapshot(saved.checkpoint));
		},
		record: (_selected, checkpoint) => {
			saved.checkpoint = snapshot(checkpoint);
			return Promise.resolve();
		},
		handoff: () => Promise.resolve(handoff),
		owner: () => Promise.resolve(owner),
		observe: () => {
			if (calls.stops > NONE || (continuation !== undefined && continuation.phase !== "prepared")) {
				return Promise.resolve("stopped");
			}
			return Promise.resolve("live");
		},
		request: (_selected, command) => {
			if (command.kind === "stop") {
				boundaryPhases.push(saved.checkpoint.continuation!.phase);
				calls.stops += ONE;
				return Promise.resolve(handoff);
			}
			if (
				command.kind === "status" &&
				current.id === outgoing.id &&
				saved.checkpoint.continuation?.phase === "drained"
			) {
				return Promise.reject(absentSocket);
			}
			if (command.kind === "recover") {
				calls.recoveries += ONE;
			}
			return Promise.resolve(current);
		},
		start: async (_selected, effect) => {
			boundaryPhases.push(saved.checkpoint.continuation!.phase);
			calls.starts += ONE;
			current = replacement;
			await effect("idle_service_removed");
			await effect("native_service_submitted");
			return supervisor;
		},
		supervisor: () => supervisor,
		verify: () => Promise.resolve(),
		now: () => clock,
		pause: () => {
			clock += POLL_MS;
			return Promise.resolve();
		},
	};
	return {
		deps,
		calls,
		saved,
		boundaryPhases,
		setCurrent: (status: DaemonStatus) => {
			current = status;
		},
	};
}
function leg(
	phase: "prepared" | "stop_requested" | "drained" | "start_requested" | "observed",
): RestartContinuation {
	const evidence = { outgoing: { id: outgoing.id, pid: owner.pid, owner }, confirmedEffects: [] };
	if (phase === "prepared" || phase === "stop_requested") {
		return { ...evidence, phase };
	}
	if (phase === "observed") {
		return { ...evidence, phase, handoff, daemon: replacement };
	}
	return { ...evidence, phase, handoff };
}

// eslint-disable-next-line max-statements -- Check original evidence and additional-leg effects together.
test("explicit continuation preserves the original receipt and verifies both inventories", async () => {
	const { deps, calls, saved, boundaryPhases } = fixture();
	const result = await restartServer(target, deps, "replace-retained");
	expect(result.daemon).toEqual(replacement);
	expect(result.previous).toBeNull();
	expect(calls).toEqual({ starts: ONE, stops: ONE, recoveries: ONE });
	const { continuation, state, ...retained } = saved.checkpoint;
	const { state: _originalState, ...evidence } = original;
	expect(retained).toEqual(evidence);
	expect(state).toBe("done");
	expect(continuation?.phase).toBe("observed");
	expect(boundaryPhases).toEqual(["stop_requested", "start_requested"]);
	expect(result.confirmedEffects).toEqual(original.confirmedEffects);
	expect(result.continuation?.confirmedEffects).toEqual([
		"stop_acknowledged",
		"handoff_verified",
		"outgoing_exited",
		"idle_service_removed",
		"native_service_submitted",
		"replacement_observed",
		"recovery_verified",
	]);
});

test("a lost stop response permits completion after the exact handoff and process exit", async () => {
	const { deps, calls, saved } = fixture();
	const { request, observe } = deps;
	deps.request = (selected, command) => {
		if (command.kind === "stop") {
			calls.stops += ONE;
			return Promise.reject(
				new DaemonUnavailableError("stop", "transport", new Error("lost response")),
			);
		}
		return request(selected, command);
	};
	deps.observe = (process) => {
		if (deps.now() === NONE) {
			return Promise.resolve("live");
		}
		return observe(process);
	};
	const result = await restartServer(target, deps, "replace-retained");
	expect(result.daemon.id).toBe(replacement.id);
	expect(deps.now()).toBe(POLL_MS);
	expect(calls.stops).toBe(ONE);
	expect(saved.checkpoint.continuation).toMatchObject({
		phase: "observed",
		stopFailure: { phase: "transport" },
	});
});

test("a delayed drain retains its phase without removing a live service and resumes without another stop", async () => {
	const { deps, calls, saved } = fixture();
	deps.observe = () => Promise.resolve("live");
	deps.pause = () => {
		deps.now = () => DEADLINE_MS;
		return Promise.resolve();
	};
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(calls.starts).toBe(NONE);
	expect(saved.checkpoint).toMatchObject({
		...original,
		continuation: { phase: "stop_requested" },
	});
	deps.observe = () => Promise.resolve("stopped");
	await restartServer(target, deps);
	expect(calls.stops).toBe(ONE);
	expect(calls.starts).toBe(ONE);
});

test.each([
	{ phase: "prepared", stops: ONE, starts: ONE },
	{ phase: "drained", stops: NONE, starts: ONE },
	{ phase: "start_requested", stops: NONE, starts: NONE },
	{ phase: "observed", stops: NONE, starts: NONE },
] as const)(
	"continuation resumes $phase without repeating completed boundaries",
	async ({ phase, stops, starts }) => {
		const { deps, calls, saved, setCurrent } = fixture(leg(phase));
		if (phase === "start_requested" || phase === "observed") {
			setCurrent(replacement);
		}
		await restartServer(target, deps);
		expect(calls.stops).toBe(stops);
		expect(calls.starts).toBe(starts);
		expect(saved.checkpoint.state).toBe("done");
	},
);

test("interruption after native submission resumes observation without another native launch", async () => {
	const { deps, calls, saved, setCurrent } = fixture();
	deps.start = async (_selected, effect) => {
		calls.starts += ONE;
		setCurrent(replacement);
		await effect("native_service_submitted");
		throw new Error("caller interrupted");
	};
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(saved.checkpoint.continuation?.phase).toBe("start_requested");
	await restartServer(target, deps, "replace-retained");
	expect(calls.starts).toBe(ONE);
	expect(calls.stops).toBe(ONE);
});

test("interruption after new observation resumes recovery in place", async () => {
	const { deps, calls, saved } = fixture();
	const { request } = deps;
	let interrupted = true;
	deps.request = (selected, command) => {
		if (command.kind === "recover" && interrupted) {
			return Promise.reject(
				new DaemonUnavailableError("recover", "transport", new Error("interrupted")),
			);
		}
		return request(selected, command);
	};
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(saved.checkpoint.continuation?.phase).toBe("observed");
	interrupted = false;
	await restartServer(target, deps, "replace-retained");
	expect(calls.starts).toBe(ONE);
	expect(calls.stops).toBe(ONE);
});

test.each([
	{ name: "lifetime", change: { id: "foreign" } },
	{ name: "pid", change: { pid: 99 } },
	{ name: "socket", change: { socket: "/foreign/socket" } },
	{ name: "state", change: { state: "/foreign/state" } },
])("explicit admission refuses $name mismatch without changing evidence", async ({ change }) => {
	const { deps, calls, saved, setCurrent } = fixture();
	setCurrent({ ...outgoing, ...change });
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(saved.checkpoint).toEqual(original);
	expect(calls.starts + calls.stops).toBe(NONE);
});

const admissionCases: { failure: string; continuation: RestartContinuation | undefined }[] = [
	{ failure: "unavailable", continuation: undefined },
	{ failure: "unowned", continuation: undefined },
	{ failure: "fingerprint", continuation: leg("prepared") },
];
test.each(admissionCases)(
	"explicit admission refuses $failure without changing evidence",
	async ({ failure, continuation }) => {
		const { deps, calls, saved } = fixture(continuation);
		const initial = structuredClone(saved.checkpoint);
		if (failure === "unavailable") {
			deps.request = () => Promise.reject(absentSocket);
		} else if (failure === "unowned") {
			deps.verify = () => Promise.reject(new Error("native ownership mismatch"));
		} else {
			deps.owner = () => Promise.resolve({ ...owner, startTime: 999 });
		}
		await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
			DaemonLifecycleError,
		);
		expect(saved.checkpoint).toEqual(initial);
		expect(calls.starts + calls.stops).toBe(NONE);
	},
);

const invalidManifests: { name: string; registrations: Stopped["registrations"] }[] = [
	{ name: "original attempt", registrations: [{ ...registrations[NONE]!, attempts: [added] }] },
	{
		name: "database",
		registrations: [
			{ ...registrations[NONE]!, repository: { ...repository, beadsDb: "/other/db" } },
		],
	},
	{ name: "intent", registrations: [{ ...registrations[NONE]!, intent: "asleep" }] },
	{ name: "membership", registrations: [] },
	{
		name: "attempt/spawn pairing",
		registrations: [
			{ ...registrations[NONE]!, attempts: [{ ...originalAttempts[NONE]!, spawnId: "foreign" }] },
		],
	},
];
test.each(invalidManifests)(
	"later handoff rejects changed $name before startup",
	async ({ registrations: later }) => {
		const { deps, calls, saved } = fixture();
		deps.handoff = () => Promise.resolve({ ...handoff, registrations: later });
		await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
			DaemonLifecycleError,
		);
		expect(calls.starts).toBe(NONE);
		expect(saved.checkpoint.registrations).toEqual(original.registrations);
	},
);

const invalidRecoveries: { name: string; colonies: DaemonStatus["colonies"] }[] = [
	{ name: "intervening attempt lost", colonies: outgoing.colonies },
	{
		name: "original attempt lost",
		colonies: [{ ...replacement.colonies[NONE]!, attempts: [added] }],
	},
	{
		name: "failed recovery",
		colonies: [{ ...replacement.colonies[NONE]!, state: "failed" as const, message: "failed" }],
	},
	{
		name: "duplicate live spawn",
		colonies: [
			{
				...replacement.colonies[NONE]!,
				attempts: [...originalAttempts, added, { ...added, id: "duplicate" }],
			},
		],
	},
];
test.each(invalidRecoveries)(
	"new recovery rejects $name without completing the original obligation",
	async ({ colonies }) => {
		const { deps, saved, setCurrent } = fixture(leg("observed"));
		setCurrent({ ...replacement, colonies: [...colonies] });
		await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
		expect(saved.checkpoint.state).toBe("failed");
		expect(saved.checkpoint.confirmedEffects).toEqual(original.confirmedEffects);
		expect(saved.checkpoint.continuation?.confirmedEffects).not.toContain("recovery_verified");
	},
);

test("both inventories permit natural survivor completion", async () => {
	const { deps, setCurrent } = fixture(leg("observed"));
	const completed = structuredClone(replacement);
	for (const colony of completed.colonies) {
		for (const attempt of colony.attempts) {
			attempt.state = "exited";
		}
	}
	setCurrent(completed);
	const result = await restartServer(target, deps);
	expect(result.continuation?.confirmedEffects).toContain("recovery_verified");
});

test("uncertain startup never repeats submission when no replacement appears", async () => {
	const { deps, calls, saved } = fixture(leg("start_requested"));
	deps.request = () => Promise.reject(absentSocket);
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(calls.starts).toBe(NONE);
	expect(saved.checkpoint.continuation?.phase).toBe("start_requested");
});

test("a different daemon occupying the drained endpoint is refused before native startup", async () => {
	const { deps, calls, saved, setCurrent } = fixture(leg("drained"));
	setCurrent({ ...outgoing, id: "foreign", pid: 99 });
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(calls.starts).toBe(NONE);
	expect(saved.checkpoint.continuation?.phase).toBe("drained");
});

test("interruption before stop intent persists a resumable prepared admission", async () => {
	const { deps, calls, saved } = fixture();
	const { record } = deps;
	let interrupted = true;
	deps.record = async (selected, checkpoint) => {
		await record(selected, checkpoint);
		if (checkpoint.continuation?.phase === "prepared" && interrupted) {
			interrupted = false;
			throw new Error("interrupted before stop intent");
		}
	};
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(saved.checkpoint.continuation?.phase).toBe("prepared");
	await restartServer(target, deps);
	expect(calls.stops).toBe(ONE);
	expect(calls.starts).toBe(ONE);
});

function snapshot(checkpoint: RestartCheckpoint): RestartCheckpoint {
	const saved = { ...checkpoint, confirmedEffects: [...checkpoint.confirmedEffects] };
	if (checkpoint.continuation) {
		saved.continuation = {
			...checkpoint.continuation,
			confirmedEffects: [...checkpoint.continuation.confirmedEffects],
		};
	}
	return saved;
}

test("persisted stop intent before submission fails on a still-live owner without issuing another stop", async () => {
	const { deps, calls, saved } = fixture(leg("stop_requested"));
	deps.observe = () => Promise.resolve("live");
	deps.pause = () => {
		deps.now = () => DEADLINE_MS;
		return Promise.resolve();
	};
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	expect(calls).toEqual({ starts: NONE, stops: NONE, recoveries: NONE });
	expect(saved.checkpoint.continuation?.phase).toBe("stop_requested");
});

test("a delayed replacement can be observed after an incomplete startup without resubmitting", async () => {
	const { deps, calls, setCurrent } = fixture(leg("start_requested"));
	const { request } = deps;
	deps.request = () => Promise.reject(absentSocket);
	await expect(restartServer(target, deps)).rejects.toBeInstanceOf(DaemonLifecycleError);
	setCurrent(replacement);
	deps.request = request;
	const result = await restartServer(target, deps);
	expect(result.daemon.id).toBe(replacement.id);
	expect(calls.starts).toBe(NONE);
});

test("repeating explicit continuation after completion cannot add another replacement leg", async () => {
	const { deps, calls, saved } = fixture();
	await restartServer(target, deps, "replace-retained");
	await expect(restartServer(target, deps, "replace-retained")).rejects.toBeInstanceOf(
		DaemonLifecycleError,
	);
	expect(calls).toEqual({ starts: ONE, stops: ONE, recoveries: ONE });
	expect(saved.checkpoint.state).toBe("done");
});
