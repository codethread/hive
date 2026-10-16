import type { DaemonResponse, ServerTarget } from "./client.ts";
import type { ColonyRequest } from "@hive/shared";
import type { ProcessFingerprint } from "./processes.ts";
import { connectionUnavailable } from "./client.ts";

const TIMEOUT_MS = 10_000;
export type DaemonStatus = Extract<DaemonResponse, { kind: "status" }>;
export type Stopped = Extract<DaemonResponse, { kind: "stopped" }>;
export interface DaemonSupervisor {
	/** Native supervisor responsible for this daemon's process lifetime. */
	kind: "launchd" | "systemd";
	/** Fully qualified native service target. */
	service: string;
}
export interface RestartCheckpoint {
	/** Restart disposition retained if the caller is interrupted. */
	state: "running" | "failed" | "done";
	/** Prior daemon identity and process evidence, absent on a cold recovery. */
	previous: { id: string; pid: number; owner: ProcessFingerprint } | null;
	/** Durable registrations and attempts from the current or retained drained handoff. */
	registrations: Stopped["registrations"] | null;
	/** Observed replacement; repository recovery is verified before completion. */
	daemon: DaemonStatus | null;
	/** Confirmed boundary effects, in order. */
	confirmedEffects: string[];
}
export interface DaemonLifecycle {
	/** Check platform, supervisor domain and runtime before stopping a daemon. */
	prepare: (target: ServerTarget) => Promise<void>;
	/** Recover the last quiescent handoff after an unavailable daemon. */
	handoff: (target: ServerTarget) => Promise<Stopped | undefined>;
	/** Preserve unfinished recovery checks across a caller interruption or partial failure. */
	pending: (target: ServerTarget) => Promise<Stopped["registrations"] | undefined>;
	/** Atomically retain the restart handoff and effects. */
	record: (target: ServerTarget, checkpoint: RestartCheckpoint) => Promise<void>;
	/** Validated local socket protocol. */
	request: (target: ServerTarget, request: ColonyRequest) => Promise<DaemonResponse>;
	/** Read a receipt matching the observed daemon identity. */
	owner: (target: ServerTarget, status: DaemonStatus) => Promise<ProcessFingerprint>;
	/** Verify the recorded process lifetime against the operating system. */
	observe: (owner: ProcessFingerprint) => Promise<"live" | "stopped">;
	/** Submit an independently owned native service, recording confirmed effects. */
	start: (
		target: ServerTarget,
		effect: (value: string) => Promise<void>,
	) => Promise<DaemonSupervisor>;
	/** Prove native service membership and independent process ownership. */
	verify: (
		target: ServerTarget,
		status: DaemonStatus,
		supervisor: DaemonSupervisor,
	) => Promise<void>;
	/** Monotonic polling clock in milliseconds. */
	now: () => number;
	/** Wait for the next bounded observation. */
	pause: () => Promise<void>;
}
export interface RestartedDaemon {
	/** Verified daemon replacement result. */
	kind: "restarted";
	/** Previous lifetime, absent when the daemon was already unavailable. */
	previous: { id: string; pid: number } | null;
	/** Distinct ready daemon and recovered repository state. */
	daemon: DaemonStatus;
	/** Independent native service ownership. */
	supervisor: DaemonSupervisor;
	/** Confirmed restart steps, including recovery verification. */
	confirmedEffects: string[];
}
export class DaemonLifecycleError extends Error {
	readonly reason = "daemon_lifecycle_incomplete";
	readonly target: Pick<ServerTarget, "socket" | "state">;
	readonly confirmedEffects: string[];
	checkpoint: RestartCheckpoint | undefined = undefined;
	// eslint-disable-next-line max-params -- Error preserves the operational target and confirmed effects with its cause.
	constructor(
		message: string,
		target: Pick<ServerTarget, "socket" | "state">,
		confirmedEffects: string[],
		options: ErrorOptions,
	) {
		super(message, options);
		this.name = "DaemonLifecycleError";
		this.target = target;
		this.confirmedEffects = confirmedEffects;
	}
}

// eslint-disable-next-line max-statements -- Verify native ownership before the repository mutation.
export async function requestLazyServer(
	target: ServerTarget,
	request: Extract<ColonyRequest, { kind: "wake" | "add" }>,
	deps: DaemonLifecycle,
): Promise<DaemonResponse> {
	try {
		await deps.request(target, { kind: "status" });
	} catch (error) {
		if (!connectionUnavailable(error)) {
			throw error;
		}
		const effects: string[] = [];
		try {
			await deps.prepare(target);
			const supervisor = await deps.start(target, (effect) => {
				effects.push(effect);
				return Promise.resolve();
			});
			const ready = await waitForServer(target, deps);
			await deps.verify(target, ready, supervisor);
		} catch (startupError) {
			throw lifecycleFailure(target, effects, startupError);
		}
	}
	return deps.request(target, request);
}

/** Prove the drained daemon exited before removing its service; live bootout kills detached bees. */
// eslint-disable-next-line max-statements -- Keep confirmed effects adjacent to each restart boundary.
export async function restartServer(
	target: ServerTarget,
	deps: DaemonLifecycle,
): Promise<RestartedDaemon> {
	const effects: string[] = [];
	let recording = false;
	// eslint-disable-next-line unicorn/no-null -- The result distinguishes cold recovery from replacement.
	let previous: RestartedDaemon["previous"] = null;
	let registrations: Stopped["registrations"] | undefined = undefined;
	/* eslint-disable unicorn/no-null -- JSON distinguishes unobserved identities and handoffs. */
	const checkpoint: RestartCheckpoint = {
		state: "running",
		previous: null,
		registrations: null,
		daemon: null,
		confirmedEffects: effects,
	};
	/* eslint-enable unicorn/no-null */
	const effect = async (value: string) => {
		effects.push(value);
		await deps.record(target, checkpoint);
	};
	try {
		await deps.prepare(target);
		const pending = await deps.pending(target);
		registrations = pending;
		if (pending) {
			checkpoint.registrations = pending;
		}
		const before = await availableStatus(target, deps);
		if (pending && before) {
			const recovery = await deps.request(target, { kind: "recover" });
			if (recovery.kind !== "status") {
				throw new Error("Expected recovery status");
			}
			verifyRecovery(pending, recovery);
		}
		recording = true;
		await deps.record(target, checkpoint);
		if (before) {
			previous = { id: before.id, pid: before.pid };
			const owner = await deps.owner(target, before);
			checkpoint.previous = { ...previous, owner };
			await effect("stop_requested");
			const stopped = await deps.request(target, { kind: "stop", expectedId: before.id });
			if (stopped.kind !== "stopped" || stopped.id !== before.id) {
				throw new Error("Stop did not acknowledge the selected daemon lifetime");
			}
			({ registrations } = stopped);
			checkpoint.registrations = registrations;
			await effect("stop_acknowledged");
			await waitForExit(owner, deps);
			await effect("old_daemon_exited");
		} else {
			const handoff = await deps.handoff(target);
			if (handoff) {
				({ registrations } = handoff);
			}
			if (registrations) {
				checkpoint.registrations = registrations;
			}
		}
		const supervisor = await deps.start(target, effect);
		const ready = await waitForServer(target, deps);
		checkpoint.daemon = ready;
		await effect("replacement_observed");
		const daemon = await deps.request(target, { kind: "recover" });
		if (
			daemon.kind !== "status" ||
			daemon.id !== ready.id ||
			daemon.pid !== ready.pid ||
			(previous && daemon.id === previous.id)
		) {
			throw new Error("Replacement daemon identity was not established");
		}
		await deps.verify(target, daemon, supervisor);
		checkpoint.daemon = daemon;
		await effect("replacement_ready");
		verifyRecovery(registrations, daemon);
		checkpoint.state = "done";
		await effect("recovery_verified");
		return { confirmedEffects: effects, daemon, kind: "restarted", previous, supervisor };
	} catch (error) {
		checkpoint.state = "failed";
		const failure = lifecycleFailure(target, effects, error);
		failure.checkpoint = checkpoint;
		if (recording) {
			try {
				await deps.record(target, checkpoint);
			} catch (persistenceError) {
				failure.message += ` Restart receipt could not be retained: ${String(persistenceError)}`;
			}
		}
		throw failure;
	}
}

// --- Private functions ---
async function availableStatus(
	target: ServerTarget,
	deps: DaemonLifecycle,
): Promise<DaemonStatus | null> {
	try {
		const result = await deps.request(target, { kind: "status" });
		if (result.kind !== "status") {
			throw new Error("Expected daemon status");
		}
		return result;
	} catch (error) {
		if (!connectionUnavailable(error)) {
			throw error;
		}
		// eslint-disable-next-line unicorn/no-null -- Missing daemon is an explicit observation.
		return null;
	}
}
async function waitForServer(target: ServerTarget, deps: DaemonLifecycle): Promise<DaemonStatus> {
	const deadline = deps.now() + TIMEOUT_MS;
	/* eslint-disable no-await-in-loop -- Sequential bounded readiness probes. */
	while (deps.now() < deadline) {
		const status = await availableStatus(target, deps);
		if (status) {
			return status;
		}
		await deps.pause();
	}
	/* eslint-enable no-await-in-loop */
	throw new Error(`Daemon did not become ready; inspect ${target.state}/daemon.log`);
}
async function waitForExit(owner: ProcessFingerprint, deps: DaemonLifecycle): Promise<void> {
	const deadline = deps.now() + TIMEOUT_MS;
	/* eslint-disable no-await-in-loop -- An acknowledgment does not prove the old lifetime ended. */
	while ((await deps.observe(owner)) === "live") {
		if (deps.now() >= deadline) {
			throw new Error("Old daemon is still running; its native service was not removed");
		}
		await deps.pause();
	}
	/* eslint-enable no-await-in-loop */
}
// eslint-disable-next-line max-statements -- Verify complete recovery while allowing natural attempt completion.
function verifyRecovery(
	registrations: Stopped["registrations"] | undefined,
	daemon: DaemonStatus,
): void {
	const durable = daemon.colonies.filter(({ registration }) => registration === "durable");
	for (const colony of durable) {
		if (colony.state === "failed") {
			throw new Error(`Repository recovery failed: ${colony.repository.root}: ${colony.message}`);
		}
		const active = colony.attempts.filter(
			({ state }) => state === "running" || state === "starting",
		);
		if (new Set(active.map(({ spawnId }) => spawnId)).size !== active.length) {
			throw new Error(`Recovery has duplicate live attempts in ${colony.repository.root}`);
		}
	}
	if (registrations === undefined) {
		return;
	}
	if (durable.length !== registrations.length) {
		throw new Error("Durable repository membership changed during restart");
	}
	for (const before of registrations) {
		const after = durable.find(({ repository }) => repository.root === before.repository.root);
		if (
			!after ||
			after.repository.beadsDb !== before.repository.beadsDb ||
			after.intent !== before.intent
		) {
			throw new Error(
				`Repository authority or awake intent was not restored: ${before.repository.root}`,
			);
		}
		for (const attempt of before.attempts) {
			if (
				!after.attempts.some(({ id, spawnId }) => id === attempt.id && spawnId === attempt.spawnId)
			) {
				throw new Error(`Recovery lost attempt ${attempt.id} in ${before.repository.root}`);
			}
		}
	}
}
function lifecycleFailure(
	target: ServerTarget,
	effects: string[],
	cause: unknown,
): DaemonLifecycleError {
	return new DaemonLifecycleError(
		`${String(cause)}. Inspect daemon status and ${target.state}/daemon.log; ` +
			`retain ${target.state}/restart.json and ${target.state}/daemon-handoff.json when present. ` +
			"Resolve the failure before retrying the same target; " +
			"completion requires verified readiness and repository recovery.",
		{ socket: target.socket, state: target.state },
		effects,
		{ cause },
	);
}
