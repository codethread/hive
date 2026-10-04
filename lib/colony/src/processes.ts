// eslint-disable-next-line import/no-nodejs-modules -- Owned execution artifacts are written atomically.
import { readFile, rename } from "node:fs/promises";
import type { ProcessDescriptor } from "ps-list";
import type { Subprocess } from "bun";
// eslint-disable-next-line import/no-nodejs-modules -- Execution ownership is stored beside its launch receipt.
import { join } from "node:path";
import psList from "ps-list";
import { z } from "zod";

const INTERVAL = 50;
const STOP_TIMEOUT = 5000;
const EMPTY = 0;
export const processFingerprintSchema = z.strictObject({
	cmd: z.string(),
	pid: z.number().int().positive(),
	ppid: z.number().int().nonnegative(),
	startTime: z.number(),
});
const ownershipSchema = z.strictObject({
	error: z.string().nullable(),
	harnessPid: z.number().int().positive().nullable(),
	phase: z.enum(["starting", "running", "exited"]),
	processes: z.array(processFingerprintSchema),
	supervisor: processFingerprintSchema,
	token: z.string(),
});
export type ProcessFingerprint = z.infer<typeof processFingerprintSchema>;
type Fingerprint = ProcessFingerprint;
type Ownership = z.infer<typeof ownershipSchema>;
const supervisorSchema = z.strictObject({ process: processFingerprintSchema, token: z.string() });
const permissionSchema = z.strictObject({ token: z.string() });
export interface ExecutionRef {
	/** Directory containing this attempt's immutable and observed artifacts. */
	directory: string;
	/** Unpredictable token joining launch and ownership records. */
	token: string;
}

/** Select live owned lifetimes and discover descendants only through their verified lineage.
 * Historical fingerprints remain launch evidence; a newer lifetime with the same PID is not owned.
 */
export function currentOwnedProcesses(
	recordedProcesses: ProcessFingerprint[],
	snapshot: ProcessDescriptor[],
): ProcessFingerprint[] {
	const live = recordedProcesses.flatMap((recorded) => {
		const current = snapshot.find(({ pid }) => pid === recorded.pid);
		if (!current || (current.startTime && current.startTime.getTime() > recorded.startTime)) {
			return [];
		}
		verify(recorded, current);
		return [recorded];
	});
	for (const parent of live) {
		for (const child of snapshot.filter(({ ppid }) => ppid === parent.pid)) {
			if (!live.some(({ pid }) => pid === child.pid)) {
				live.push(fingerprint(child));
			}
		}
	}
	return live;
}

/** Fingerprint the calling process using the same evidence checked before signalling. */
export async function currentProcessFingerprint(): Promise<ProcessFingerprint> {
	const snapshot = await psList();
	const current = snapshot.find(({ pid }) => pid === process.pid);
	if (!current) {
		throw new Error("Cannot fingerprint the calling process");
	}
	return fingerprint(current);
}
/** PID plus OS start time identifies an observed process; argv can change during exec or title updates. */
export async function observeProcess(recorded: ProcessFingerprint): Promise<"live" | "stopped"> {
	const snapshot = await psList();
	const current = snapshot.find(({ pid }) => pid === recorded.pid);
	if (!current) {
		return "stopped";
	}
	verify(recorded, current);
	return "live";
}

/** Publish the supervisor identity before waiting for the daemon's durable launch permission. */
export async function awaitExecutionPermission(ref: ExecutionRef): Promise<void> {
	const supervisor = { process: await currentProcessFingerprint(), token: ref.token };
	const temporary = join(ref.directory, "supervisor.json.tmp");
	await Bun.write(temporary, JSON.stringify(supervisor));
	await rename(temporary, join(ref.directory, "supervisor.json"));
	/* eslint-disable no-await-in-loop -- A detached supervisor waits without launching until its recorded owner authorizes it. */
	while (!(await Bun.file(join(ref.directory, "permission.json")).exists())) {
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
	await verifyPermission(ref);
}
/** Recovery can complete a verified handoff; an already executing worker needs no new permission. */
// eslint-disable-next-line max-statements -- Validate existing authority before publishing a new durable launch permission.
export async function resumeExecution(
	ref: ExecutionRef,
	recordSupervisor: (owner: ProcessFingerprint) => void,
): Promise<void> {
	if (await Bun.file(join(ref.directory, "ownership.json")).exists()) {
		return;
	}
	const supervisor = await awaitSupervisor(ref);
	if ((await observeProcess(supervisor)) === "live") {
		recordSupervisor(supervisor);
		if (await Bun.file(join(ref.directory, "permission.json")).exists()) {
			await verifyPermission(ref);
			return;
		}
		const temporary = join(ref.directory, "permission.json.tmp");
		await Bun.write(temporary, JSON.stringify({ token: ref.token }));
		await rename(temporary, join(ref.directory, "permission.json"));
	}
}

/** Observe only the execution tree; the supervisor itself performs artifact bookkeeping. */
// eslint-disable-next-line max-statements -- Distinguish verified pending supervisors from running and proven stopped harnesses.
export async function observeExecution(
	ref: ExecutionRef,
): Promise<{ kind: "live" } | { kind: "stopped" }> {
	if (!(await Bun.file(join(ref.directory, "ownership.json")).exists())) {
		const supervisor = await awaitSupervisor(ref);
		return { kind: await observeProcess(supervisor) };
	}
	const owned = await readOwnership(ref);
	const live = currentOwnedProcesses(owned.processes, await psList());
	if (live.length > EMPTY) {
		return { kind: "live" };
	}
	if (owned.phase !== "exited" && owned.processes.length === EMPTY) {
		if ((await observeProcess(owned.supervisor)) === "live") {
			return { kind: "live" };
		}
		throw new Error(`Execution ${ref.directory} has no proven launch or exit`);
	}
	return { kind: "stopped" };
}

/** Stop verified descendants even when they have moved into separate process groups. */
// eslint-disable-next-line max-statements -- Verification, signalling and bounded stop confirmation are one ownership boundary.
export async function stopExecution(ref: ExecutionRef): Promise<void> {
	const deadline = Date.now() + STOP_TIMEOUT;
	if (!(await Bun.file(join(ref.directory, "ownership.json")).exists())) {
		await stopSupervisor(await awaitSupervisor(ref));
		// A stopped supervisor cannot launch later; ownership is written before any harness spawn.
		if (!(await Bun.file(join(ref.directory, "ownership.json")).exists())) {
			return;
		}
	}
	/* eslint-disable no-await-in-loop -- Re-observe fingerprints before every bounded cleanup pass. */
	while (true) {
		const owned = await readOwnership(ref);
		const live = currentOwnedProcesses(owned.processes, await psList());
		if (live.length === EMPTY) {
			const observed = await observeExecution(ref);
			if (observed.kind === "stopped") {
				return;
			}
		}
		if (Date.now() >= deadline) {
			throw new Error(`Owned execution ${ref.directory} did not stop before its deadline`);
		}
		await writeCleanup(ref, owned.processes, live);
		for (const recorded of live.toReversed()) {
			await signalOwned(recorded);
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
}

/** The child handle proves short-lived root exit; process snapshots retain observed descendants. */
// eslint-disable-next-line max-statements -- Keep child creation, ownership recording and completion proof together.
export async function runOwnedExecution(
	ref: ExecutionRef,
	start: () => Subprocess,
	onStarted: (pid: number) => Promise<void>,
): Promise<{ pid: number; code: number }> {
	const snapshot = await psList();
	const supervisor = snapshot.find(({ pid }) => pid === process.pid);
	if (!supervisor) {
		throw new Error("Cannot fingerprint the worker supervisor");
	}
	const owned: Ownership = {
		// eslint-disable-next-line unicorn/no-null -- Explicit absent error and harness PID in persisted ownership.
		error: null,
		// eslint-disable-next-line unicorn/no-null -- No harness has been spawned yet.
		harnessPid: null,
		phase: "starting",
		processes: [],
		supervisor: fingerprint(supervisor),
		token: ref.token,
	};
	await writeOwnership(ref, owned);
	try {
		const child = start();
		let exited = false;
		// eslint-disable-next-line promise/prefer-await-to-then -- Observe child completion concurrently with ownership snapshots.
		const completion = child.exited.then((code) => {
			exited = true;
			return code;
		});
		owned.harnessPid = child.pid;
		owned.phase = "running";
		await capture(owned);
		await writeOwnership(ref, owned);
		await onStarted(child.pid);
		/* eslint-disable no-await-in-loop -- Capture descendant lineage throughout the live child lifetime. */
		// eslint-disable-next-line no-unmodified-loop-condition -- The owned child completion promise updates this condition.
		while (!exited) {
			await Bun.sleep(INTERVAL);
			await capture(owned);
			await writeOwnership(ref, owned);
		}
		/* eslint-enable no-await-in-loop */
		const code = await completion;
		owned.phase = "exited";
		await capture(owned);
		await writeOwnership(ref, owned);
		return { code, pid: child.pid };
	} catch (error) {
		if (owned.harnessPid === null) {
			owned.phase = "exited";
		} else {
			owned.error = String(error);
			if (error instanceof Error) {
				owned.error = error.message;
			}
		}
		await writeOwnership(ref, owned);
		throw error;
	}
}

// --- Private functions ---
async function verifyPermission(ref: ExecutionRef): Promise<void> {
	const text = await readFile(join(ref.directory, "permission.json"), "utf8");
	if (permissionSchema.parse(JSON.parse(text)).token !== ref.token) {
		throw new Error("Execution permission token mismatch");
	}
}
async function awaitSupervisor(ref: ExecutionRef): Promise<ProcessFingerprint> {
	const deadline = Date.now() + STOP_TIMEOUT;
	const path = join(ref.directory, "supervisor.json");
	/* eslint-disable no-await-in-loop -- Bound initial handoff publication; absent evidence is never inferred as stopped. */
	while (!(await Bun.file(path).exists())) {
		if (Date.now() >= deadline) {
			throw new Error(`Execution ${ref.directory} has no supervisor handoff`);
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
	const supervisor = supervisorSchema.parse(JSON.parse(await readFile(path, "utf8")));
	if (supervisor.token !== ref.token) {
		throw new Error("Supervisor handoff token mismatch");
	}
	return supervisor.process;
}
async function stopSupervisor(supervisor: ProcessFingerprint): Promise<void> {
	const deadline = Date.now() + STOP_TIMEOUT;
	/* eslint-disable no-await-in-loop -- Stop only the verified permission waiter before declaring an unstarted execution stopped. */
	while ((await observeProcess(supervisor)) === "live") {
		if (Date.now() >= deadline) {
			throw new Error(`Supervisor ${supervisor.pid} did not stop`);
		}
		await signalOwned(supervisor);
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
}
// eslint-disable-next-line max-statements -- Join independently written ownership and cleanup artifacts at one validated boundary.
async function readOwnership(ref: ExecutionRef): Promise<Ownership> {
	const owned = ownershipSchema.parse(await Bun.file(join(ref.directory, "ownership.json")).json());
	if (owned.token !== ref.token) {
		throw new Error(`Execution ${ref.directory} has a mismatched ownership token`);
	}
	if (owned.error !== null) {
		throw new Error(`Execution ownership failed: ${owned.error}`);
	}
	const cleanupFile = Bun.file(join(ref.directory, "cleanup.json"));
	if (await cleanupFile.exists()) {
		const cleanupText = await readFile(join(ref.directory, "cleanup.json"), "utf8");
		const cleanup = z
			.object({ processes: z.array(processFingerprintSchema), token: z.string() })
			.parse(JSON.parse(cleanupText));
		if (cleanup.token !== ref.token) {
			throw new Error("Cleanup ownership token mismatch");
		}
		for (const recorded of cleanup.processes) {
			if (!owned.processes.some((existing) => sameLifetime(existing, recorded))) {
				owned.processes.push(recorded);
			}
		}
	}
	return owned;
}
async function writeOwnership(ref: ExecutionRef, owned: Ownership): Promise<void> {
	const temporary = join(ref.directory, "ownership.json.tmp");
	await Bun.write(temporary, JSON.stringify(owned));
	await rename(temporary, join(ref.directory, "ownership.json"));
}
async function capture(owned: Ownership): Promise<void> {
	const snapshot = await psList();
	if (owned.harnessPid !== null && !owned.processes.some(({ pid }) => pid === owned.harnessPid)) {
		const root = snapshot.find(({ pid }) => pid === owned.harnessPid);
		if (root) {
			if (root.ppid !== owned.supervisor.pid) {
				throw new Error("Harness process no longer has the recorded supervisor parent");
			}
			owned.processes.push(fingerprint(root));
		}
	}
	for (const live of currentOwnedProcesses(owned.processes, snapshot)) {
		if (!owned.processes.some((existing) => sameLifetime(existing, live))) {
			owned.processes.push(live);
		}
	}
}
function sameLifetime(left: Fingerprint, right: Fingerprint): boolean {
	return left.pid === right.pid && left.startTime === right.startTime;
}
function fingerprint(value: ProcessDescriptor): Fingerprint {
	return processFingerprintSchema.parse({
		cmd: value.cmd,
		pid: value.pid,
		ppid: value.ppid,
		startTime: value.startTime?.getTime(),
	});
}
function verify(recorded: Fingerprint, current: ProcessDescriptor): void {
	// Ps-list reports second-resolution lstart; this is a sampled identity, not a race-free OS handle.
	if (recorded.startTime !== current.startTime?.getTime()) {
		throw new Error(
			`Ambiguous ownership of recorded PID ${recorded.pid}; refusing to signal: recorded start ${recorded.startTime}, observed start ${current.startTime?.getTime()}`,
		);
	}
}

async function signalOwned(recorded: Fingerprint): Promise<void> {
	const snapshot = await psList();
	const current = snapshot.find(({ pid }) => pid === recorded.pid);
	if (!current) {
		return;
	}
	verify(recorded, current);
	try {
		process.kill(recorded.pid, "SIGTERM");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
			throw error;
		}
	}
}
async function writeCleanup(
	ref: ExecutionRef,
	recorded: Fingerprint[],
	live: Fingerprint[],
): Promise<void> {
	const processes = [
		...recorded,
		...live.filter((candidate) => !recorded.some((existing) => sameLifetime(existing, candidate))),
	];
	const temporary = join(ref.directory, "cleanup.json.tmp");
	await Bun.write(temporary, JSON.stringify({ processes, token: ref.token }));
	await rename(temporary, join(ref.directory, "cleanup.json"));
}
