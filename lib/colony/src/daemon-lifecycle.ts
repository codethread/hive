import type { DaemonResponse, ServerTarget } from "./client.ts";
import { DaemonUnavailableError, connectionUnavailable } from "./client.ts";
import type { ColonyRequest } from "@hive/shared";
import type { ProcessFingerprint } from "./processes.ts";

const TIMEOUT_MS = 10_000;
const RECOVERY_TIMEOUT_MS = 600_000;
export type DaemonStatus = Extract<DaemonResponse, { kind: "status" }>;
export type Stopped = Extract<DaemonResponse, { kind: "stopped" }>;
export interface DaemonSupervisor {
	/** Native supervisor responsible for this daemon's process lifetime. */
	kind: "launchd" | "systemd";
	/** Fully qualified native service target. */
	service: string;
}
export interface ContinuationEvidence {
	/** Recorded replacement selected for the single additional replacement leg. */
	outgoing: {
		/** Daemon lifetime bound to the graceful stop request. */
		id: string;
		/** Process ID reported by that daemon. */
		pid: number;
		/** Verified process fingerprint retained before stop submission. */
		owner: ProcessFingerprint;
	};
	/** Confirmed effects of this additional leg, separate from the original effects. */
	confirmedEffects: string[];
	/** Lost stop response retained while handoff and process exit are inspected. */
	stopFailure?:
		| {
				/** Request boundary that reported the failure. */
				phase: "transport" | "response" | "decode" | "daemon";
				/** Original request failure diagnostic. */
				message: string;
		  }
		| undefined;
}
/** Saved progress of one explicit continuation; requested phases do not prove submission. */
export type RestartContinuation = ContinuationEvidence &
	(
		| {
				/** Admission saved; revalidate before recording stop intent. */
				phase: "prepared";
		  }
		| {
				/** Stop intent saved; resume by observing handoff and exit only. */
				phase: "stop_requested";
		  }
		| {
				/** Matched handoff and process exit verified; native startup may follow. */
				phase: "drained";
				/** Later inventory validated against the original restart manifest. */
				handoff: Stopped;
		  }
		| {
				/** Native start intent saved; resume by observing a replacement only. */
				phase: "start_requested";
				/** Verified outgoing handoff retained through uncertain startup. */
				handoff: Stopped;
		  }
		| {
				/** New daemon observed under native ownership; recovery may still be pending. */
				phase: "observed";
				/** Later inventory supplements the original recovery obligation. */
				handoff: Stopped;
				/** New daemon whose identity and recovery are checked on every retry. */
				daemon: DaemonStatus;
		  }
	);
export interface RestartCheckpoint {
	/** Restart disposition retained if the caller is interrupted. */
	state: "running" | "failed" | "done";
	/** Prior daemon identity and process evidence, absent on a cold recovery. */
	previous: { id: string; pid: number; owner: ProcessFingerprint } | null;
	/** Durable registrations and attempts from the current or retained drained handoff. */
	registrations: Stopped["registrations"] | null;
	/** Original observed replacement; an additional leg retains its new daemon separately. */
	daemon: DaemonStatus | null;
	/** Confirmed boundary effects, in order. */
	confirmedEffects: string[];
	/** Explicit additional replacement leg within this same restart obligation. */
	continuation?: RestartContinuation | undefined;
}
export interface DaemonLifecycle {
	/** Check platform, supervisor domain and runtime before stopping a daemon. */
	prepare: (target: ServerTarget) => Promise<void>;
	/** Read a handoff after verified exit, matching the outgoing fingerprint when supplied. */
	handoff: (
		target: ServerTarget,
		outgoing?: ContinuationEvidence["outgoing"],
	) => Promise<Stopped | undefined>;
	/** Read the original manifest, identities and effects of an unfinished restart for this target. */
	pending: (target: ServerTarget) => Promise<RestartCheckpoint | undefined>;
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
	/** Select the native service for this state directory without starting it. */
	supervisor: (target: ServerTarget) => DaemonSupervisor;
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
	/** Original daemon lifetime, absent when no prior identity was observed. */
	previous: { id: string; pid: number } | null;
	/** Distinct ready daemon and recovered repository state. */
	daemon: DaemonStatus;
	/** Independent native service ownership. */
	supervisor: DaemonSupervisor;
	/** Confirmed effects of the original replacement leg, in order. */
	confirmedEffects: string[];
	/** Additional leg and its effects, present only for an explicit continuation. */
	continuation?: RestartContinuation | undefined;
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
	mode: "inplace" | "replace-retained" = "inplace",
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
		if (!effects.includes(value)) {
			effects.push(value);
		}
		await deps.record(target, checkpoint);
	};
	try {
		await deps.prepare(target);
		const pending = await deps.pending(target);
		if (pending) {
			effects.push(...pending.confirmedEffects);
			Object.assign(checkpoint, pending, { confirmedEffects: effects, state: "running" });
			registrations = pending.registrations ?? undefined;
			if (pending.previous) {
				previous = { id: pending.previous.id, pid: pending.previous.pid };
			}
		}
		if (pending?.continuation || mode === "replace-retained") {
			return await continueRestart(target, deps, checkpoint, () => {
				recording = true;
			});
		}
		const before = await availableStatus(target, deps);
		if (pending?.daemon) {
			if (!before) {
				throw new Error("Recorded replacement daemon is unavailable");
			}
			assertReplacement(target, before, pending.daemon, previous);
			const supervisor = deps.supervisor(target);
			await deps.verify(target, before, supervisor);
			recording = true;
			const daemon = await finishRecovery(target, deps, checkpoint, supervisor, effect);
			return { confirmedEffects: effects, daemon, kind: "restarted", previous, supervisor };
		}
		if (registrations && before) {
			const recovery = await waitForRecovery(target, deps, before);
			verifyRecovery(registrations, recovery);
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
			registrations ??= stopped.registrations;
			checkpoint.registrations = registrations;
			await effect("stop_acknowledged");
			await waitForExit(owner, deps);
			await effect("old_daemon_exited");
		} else {
			const handoff = await deps.handoff(target);
			if (handoff) {
				registrations ??= handoff.registrations;
			}
			if (registrations) {
				checkpoint.registrations = registrations;
			}
		}
		const supervisor = await deps.start(target, effect);
		const ready = await waitForServer(target, deps);
		checkpoint.daemon = ready;
		await effect("replacement_observed");
		const daemon = await finishRecovery(target, deps, checkpoint, supervisor, effect);
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
// eslint-disable-next-line max-params, max-statements -- Preserve evidence across one additional replacement leg.
async function continueRestart(
	target: ServerTarget,
	deps: DaemonLifecycle,
	checkpoint: RestartCheckpoint,
	admitted: () => void,
): Promise<RestartedDaemon> {
	const supervisor = deps.supervisor(target);
	if (!checkpoint.daemon || !checkpoint.registrations) {
		throw new Error(
			"--replace-retained requires an unfinished restart receipt with an observed replacement " +
				"and registration manifest",
		);
	}
	let leg = checkpoint.continuation;
	if (leg) {
		assertReplacement(
			target,
			checkpoint.daemon,
			{ ...checkpoint.daemon, id: leg.outgoing.id, pid: leg.outgoing.pid },
			checkpoint.previous,
		);
		if (leg.outgoing.owner.pid !== leg.outgoing.pid) {
			throw new Error("Continuation fingerprint does not match its outgoing PID");
		}
		if ("handoff" in leg) {
			if (leg.handoff.id !== leg.outgoing.id) {
				throw new Error("Continuation handoff does not match its outgoing lifetime");
			}
			verifyManifest(checkpoint.registrations, leg.handoff.registrations);
		}
	}
	if (!leg || leg.phase === "prepared") {
		const before = await availableStatus(target, deps);
		if (!before) {
			throw new Error("Recorded replacement daemon is unavailable");
		}
		assertReplacement(target, before, checkpoint.daemon, checkpoint.previous);
		const owner = await deps.owner(target, before);
		if (leg && !sameFingerprint(owner, leg.outgoing.owner)) {
			throw new Error("Continuation outgoing process fingerprint changed");
		}
		await deps.verify(target, before, supervisor);
		if ((await deps.observe(owner)) !== "live") {
			throw new Error("Recorded replacement exited before continuation admission");
		}
		leg = {
			phase: "prepared",
			outgoing: { id: before.id, pid: before.pid, owner },
			confirmedEffects: [],
		};
		checkpoint.continuation = leg;
		admitted();
		await deps.record(target, checkpoint);
		leg = { ...leg, phase: "stop_requested" };
		checkpoint.continuation = leg;
		await deps.record(target, checkpoint);
		try {
			const stopped = await deps.request(target, { kind: "stop", expectedId: leg.outgoing.id });
			if (stopped.kind !== "stopped" || stopped.id !== leg.outgoing.id) {
				throw new Error("Stop did not acknowledge the continuation outgoing lifetime");
			}
			leg.confirmedEffects.push("stop_acknowledged");
			await deps.record(target, checkpoint);
		} catch (error) {
			if (!(error instanceof DaemonUnavailableError)) {
				throw error;
			}
			leg.stopFailure = { phase: error.phase, message: error.message };
			await deps.record(target, checkpoint);
		}
	}
	if (leg.phase !== "observed") {
		admitted();
	}
	if (leg.phase === "stop_requested") {
		const handoff = await waitForContinuationDrain(target, deps, leg.outgoing);
		verifyManifest(checkpoint.registrations, handoff.registrations);
		leg = {
			...leg,
			phase: "drained",
			handoff,
			confirmedEffects: [...leg.confirmedEffects, "handoff_verified", "outgoing_exited"],
		};
		checkpoint.continuation = leg;
		await deps.record(target, checkpoint);
	}
	if (leg.phase === "drained") {
		if (await availableStatus(target, deps)) {
			throw new Error("Selected endpoint is occupied before continuation startup");
		}
		leg = { ...leg, phase: "start_requested" };
		checkpoint.continuation = leg;
		await deps.record(target, checkpoint);
		const starting = leg;
		await deps.start(target, async (effect) => {
			starting.confirmedEffects.push(effect);
			await deps.record(target, checkpoint);
		});
	}
	if (leg.phase === "start_requested") {
		const daemon = await waitForServer(target, deps);
		assertReplacement(target, daemon, daemon, leg.outgoing);
		await deps.verify(target, daemon, supervisor);
		leg = {
			...leg,
			phase: "observed",
			daemon,
			confirmedEffects: [...leg.confirmedEffects, "replacement_observed"],
		};
		checkpoint.continuation = leg;
		await deps.record(target, checkpoint);
	}
	const before = await availableStatus(target, deps);
	if (!before) {
		throw new Error("Continuation replacement daemon is unavailable");
	}
	assertReplacement(target, before, leg.daemon, leg.outgoing);
	await deps.verify(target, before, supervisor);
	admitted();
	const daemon = await waitForRecovery(target, deps, leg.daemon, leg.outgoing);
	await deps.verify(target, daemon, supervisor);
	verifyRecovery(checkpoint.registrations, daemon);
	verifyRecovery(leg.handoff.registrations, daemon);
	leg.daemon = daemon;
	leg.confirmedEffects.push("recovery_verified");
	checkpoint.state = "done";
	await deps.record(target, checkpoint);
	return {
		kind: "restarted",
		previous: checkpoint.previous && { id: checkpoint.previous.id, pid: checkpoint.previous.pid },
		daemon,
		supervisor,
		confirmedEffects: checkpoint.confirmedEffects,
		continuation: leg,
	};
}

async function waitForContinuationDrain(
	target: ServerTarget,
	deps: DaemonLifecycle,
	outgoing: ContinuationEvidence["outgoing"],
): Promise<Stopped> {
	const deadline = deps.now() + RECOVERY_TIMEOUT_MS;
	/* eslint-disable no-await-in-loop -- A lost stop response may complete later; never resubmit it. */
	while (deps.now() < deadline) {
		if ((await deps.observe(outgoing.owner)) === "stopped") {
			const handoff = await deps.handoff(target, outgoing);
			if (handoff) {
				if (handoff.id !== outgoing.id) {
					throw new Error("Continuation handoff does not match the outgoing daemon");
				}
				return handoff;
			}
		}
		await deps.pause();
	}
	/* eslint-enable no-await-in-loop */
	throw new Error(
		"Continuation drain deadline expired without a matched handoff and verified exit; " +
			"stop_requested is retained and retries only inspect handoff and exit",
	);
}

function sameFingerprint(left: ProcessFingerprint, right: ProcessFingerprint): boolean {
	return (
		left.pid === right.pid &&
		left.startTime === right.startTime &&
		left.ppid === right.ppid &&
		left.cmd === right.cmd
	);
}

// eslint-disable-next-line max-params -- Recovery binds checkpoint updates to native ownership and effect recording.
async function finishRecovery(
	target: ServerTarget,
	deps: DaemonLifecycle,
	checkpoint: RestartCheckpoint,
	supervisor: DaemonSupervisor,
	effect: (value: string) => Promise<void>,
): Promise<DaemonStatus> {
	const ready = checkpoint.daemon!;
	const daemon = await waitForRecovery(target, deps, ready, checkpoint.previous);
	await deps.verify(target, daemon, supervisor);
	checkpoint.daemon = daemon;
	await effect("replacement_ready");
	verifyRecovery(checkpoint.registrations ?? undefined, daemon);
	checkpoint.state = "done";
	await effect("recovery_verified");
	return daemon;
}
// eslint-disable-next-line max-params, max-statements -- Keep deadline and identity checks beside each recovery probe.
async function waitForRecovery(
	target: ServerTarget,
	deps: DaemonLifecycle,
	ready: DaemonStatus,
	previous?: RestartedDaemon["previous"],
): Promise<DaemonStatus> {
	const deadline = deps.now() + RECOVERY_TIMEOUT_MS;
	/* eslint-disable no-await-in-loop -- Probe recovery sequentially, checking the deadline between responses. */
	while (deps.now() < deadline) {
		const response = await deps.request(target, { kind: "recover" });
		if (deps.now() >= deadline) {
			break;
		}
		if (response.kind === "status") {
			assertReplacement(target, response, ready, previous);
			return response;
		}
		if (response.kind !== "recovering") {
			throw new Error("Expected daemon status or recovery progress");
		}
		assertReplacement(target, response, ready, previous);
		await deps.pause();
	}
	/* eslint-enable no-await-in-loop */
	throw new Error("Daemon repository recovery did not finish before the recovery deadline");
}
// eslint-disable-next-line max-params -- Check the selected endpoint, replacement identity and original lifetime.
function assertReplacement(
	target: ServerTarget,
	daemon: Pick<DaemonStatus, "id" | "pid" | "socket" | "state">,
	ready: DaemonStatus,
	previous?: RestartedDaemon["previous"],
): void {
	if (
		daemon.id !== ready.id ||
		daemon.pid !== ready.pid ||
		daemon.socket !== target.socket ||
		daemon.state !== target.state ||
		ready.socket !== target.socket ||
		ready.state !== target.state ||
		(previous && daemon.id === previous.id)
	) {
		throw new Error("Replacement daemon identity or selected endpoint does not match");
	}
}
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
	verifyManifest(registrations, durable);
}

// eslint-disable-next-line max-statements -- Verify complete membership, authority, intent and attempt pairs together.
function verifyManifest(
	registrations: Stopped["registrations"] | undefined,
	durable: Stopped["registrations"],
): void {
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
