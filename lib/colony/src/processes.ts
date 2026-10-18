// eslint-disable-next-line import/no-nodejs-modules -- Owned execution artifacts are written atomically.
import { readFile, rename } from "node:fs/promises";
import type { Subprocess } from "bun";
// eslint-disable-next-line import/no-nodejs-modules -- Execution ownership is stored beside its launch receipt.
import { join } from "node:path";
import { z } from "zod";

const INTERVAL = 50;
const STOP_TIMEOUT = 5000;
const TERM_GRACE = 1000;
const SUCCESS = 0;
const ABSENT = 1;
const PROBE = 0;
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
	supervisor: processFingerprintSchema,
	token: z.string(),
});
const ownershipIdentitySchema = z.object({
	supervisor: processFingerprintSchema,
	token: z.string(),
});
export type ProcessFingerprint = z.infer<typeof processFingerprintSchema>;
type Fingerprint = ProcessFingerprint;
type Ownership = z.infer<typeof ownershipSchema>;
const processFieldsSchema = z.object({
	pid: z.string(),
	ppid: z.string(),
	group: z.string(),
	started: z.string(),
	cmd: z.string(),
});
const supervisorSchema = z.strictObject({ process: processFingerprintSchema, token: z.string() });
const permissionSchema = z.strictObject({ token: z.string() });
export interface ExecutionRef {
	/** Directory containing this attempt's immutable and observed artifacts. */
	directory: string;
	/** Unpredictable token joining launch and ownership records. */
	token: string;
}

/** Fingerprint only the calling process. */
export async function currentProcessFingerprint(): Promise<ProcessFingerprint> {
	const current = await readProcess(process.pid);
	if (!current) {
		throw new Error("Cannot fingerprint the calling process");
	}
	return current.process;
}
/** Check a recorded lifetime without enumerating unrelated processes. */
export async function observeProcess(recorded: ProcessFingerprint): Promise<"live" | "stopped"> {
	const current = await readProcess(recorded.pid);
	if (!current) {
		return "stopped";
	}
	verify(recorded, current.process);
	return "live";
}

/** Publish the supervisor identity before waiting for the daemon's durable launch permission. */
export async function awaitExecutionPermission(
	ref: ExecutionRef,
	deadline?: number,
): Promise<void> {
	const supervisor = { process: await currentProcessFingerprint(), token: ref.token };
	await verifyGroup(supervisor.process);
	const temporary = join(ref.directory, "supervisor.json.tmp");
	await Bun.write(temporary, JSON.stringify(supervisor));
	await rename(temporary, join(ref.directory, "supervisor.json"));
	/* eslint-disable no-await-in-loop --
	 * A detached supervisor waits without launching until its recorded owner authorizes it.
	 */
	while (!(await Bun.file(join(ref.directory, "permission.json")).exists())) {
		if (deadline !== undefined && Date.now() >= deadline) {
			throw new Error("Execution permission deadline reached");
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
	await verifyPermission(ref);
}
/** Recovery can complete a verified handoff; an already executing worker needs no new permission. */
/* eslint-disable-next-line max-statements --
 * Validate existing authority before publishing a new durable launch permission.
 */
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

/** Observe the owned group; escaped processes are outside managed execution. */
export async function observeExecution(
	ref: ExecutionRef,
): Promise<{ kind: "live" } | { kind: "stopped" }> {
	const supervisor = await executionSupervisor(ref);
	await verifyGroup(supervisor);
	if (groupExists(supervisor.pid)) {
		return { kind: "live" };
	}
	return { kind: "stopped" };
}

/** Stop the verified group with TERM, a bounded grace period, then KILL. */
export async function stopExecution(ref: ExecutionRef): Promise<void> {
	const supervisor = await executionSupervisor(ref);
	await verifyGroup(supervisor);
	if (!signalGroup(supervisor.pid, "SIGTERM")) {
		return;
	}
	if (await awaitGroupExit(supervisor.pid, TERM_GRACE)) {
		return;
	}
	await verifyGroup(supervisor);
	signalGroup(supervisor.pid, "SIGKILL");
	if (!(await awaitGroupExit(supervisor.pid, STOP_TIMEOUT))) {
		throw new Error(`Owned execution ${ref.directory} did not stop before its deadline`);
	}
}

/** The managed child handle publishes launch and exit once, without periodic snapshots. */
/* eslint-disable-next-line max-statements, max-params --
 * Keep child launch, receipt publication and the optional deadline at the execution boundary.
 */
export async function runOwnedExecution(
	ref: ExecutionRef,
	start: () => Subprocess,
	onStarted: (pid: number) => Promise<void>,
	deadline?: number,
): Promise<{ pid: number; code: number }> {
	const supervisor = await currentProcessFingerprint();
	await verifyGroup(supervisor);
	const owned: Ownership = {
		// eslint-disable-next-line unicorn/no-null -- Persist explicit absent error and harness PID.
		error: null,
		// eslint-disable-next-line unicorn/no-null -- No harness has been spawned yet.
		harnessPid: null,
		phase: "starting",
		supervisor,
		token: ref.token,
	};
	await writeOwnership(ref, owned);
	const deferTermination = () => {
		// Stay alive to enforce KILL when the supervisor deadline sends group TERM.
	};
	process.on("SIGTERM", deferTermination);
	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	try {
		if (deadline !== undefined && Date.now() >= deadline) {
			throw new Error("Execution deadline reached before launch");
		}
		const child = start();
		owned.harnessPid = child.pid;
		owned.phase = "running";
		await writeOwnership(ref, owned);
		await onStarted(child.pid);
		let completion = child.exited;
		if (deadline !== undefined) {
			/* eslint-disable-next-line promise/avoid-new -- Race an explicit deadline against native exit. */
			const timeout = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => {
						/* eslint-disable promise/prefer-await-to-then -- Timer forwards cleanup failures. */
						stopExecution(ref)
							.then(() => reject(new Error("Execution deadline reached")))
							.catch(reject);
						/* eslint-enable promise/prefer-await-to-then */
					},
					Math.max(SUCCESS, deadline - Date.now()),
				);
			});
			completion = Promise.race([completion, timeout]);
		}
		const code = await completion;
		owned.phase = "exited";
		await writeOwnership(ref, owned);
		return { code, pid: child.pid };
	} catch (error) {
		if (owned.harnessPid === null) {
			owned.phase = "exited";
		}
		owned.error = String(error);
		if (error instanceof Error) {
			owned.error = error.message;
		}
		await writeOwnership(ref, owned);
		throw error;
	} finally {
		clearTimeout(timer);
		process.off("SIGTERM", deferTermination);
	}
}

/** Parse the single-PID ps boundary; malformed or missing lifetime evidence fails loudly. */
export function parseProcess(output: string): { process: Fingerprint; group: number } {
	const match =
		// eslint-disable-next-line @stylistic/max-len -- Keep the single ps row pattern together.
		/^\s*(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<group>\d+)\s+(?<started>(?:\w{3}\s+){2}\d{1,2}\s+(?:\d{2}:){2}\d{2}\s+\d{4})\s+(?<cmd>.+?)\s*$/u.exec(
			output,
		);
	const { pid, ppid, group, started, cmd } = processFieldsSchema.parse(match?.groups);
	return {
		group: z.number().int().positive().parse(Number(group)),
		process: processFingerprintSchema.parse({
			cmd,
			pid: Number(pid),
			ppid: Number(ppid),
			startTime: Date.parse(started),
		}),
	};
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
	/* eslint-disable no-await-in-loop --
	 * Bound initial handoff publication; absent evidence is never inferred as stopped.
	 */
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
async function executionSupervisor(ref: ExecutionRef): Promise<ProcessFingerprint> {
	if (!(await Bun.file(join(ref.directory, "ownership.json")).exists())) {
		return awaitSupervisor(ref);
	}
	const owned = ownershipIdentitySchema.parse(
		await Bun.file(join(ref.directory, "ownership.json")).json(),
	);
	if (owned.token !== ref.token) {
		throw new Error(`Execution ${ref.directory} has a mismatched ownership token`);
	}
	return owned.supervisor;
}
async function writeOwnership(ref: ExecutionRef, owned: Ownership): Promise<void> {
	const temporary = join(ref.directory, "ownership.json.tmp");
	await Bun.write(temporary, JSON.stringify(owned));
	await rename(temporary, join(ref.directory, "ownership.json"));
}
function verify(recorded: Fingerprint, current: Fingerprint): void {
	if (recorded.startTime !== current.startTime) {
		throw new Error(`Ambiguous ownership of recorded PID ${recorded.pid}; refusing to signal`);
	}
}
async function verifyGroup(supervisor: Fingerprint): Promise<void> {
	const current = await readProcess(supervisor.pid);
	if (current) {
		verify(supervisor, current.process);
		if (current.group !== supervisor.pid) {
			throw new Error(`Supervisor ${supervisor.pid} does not own its process group`);
		}
	}
}
function groupExists(pid: number): boolean {
	return signalGroup(pid, PROBE);
}
function signalGroup(pid: number, signal: NodeJS.Signals | number): boolean {
	return signalProcess(-pid, signal);
}
function signalProcess(pid: number, signal: NodeJS.Signals | number): boolean {
	try {
		process.kill(pid, signal);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") {
			return false;
		}
		throw error;
	}
}
async function awaitGroupExit(pid: number, timeout: number): Promise<boolean> {
	const deadline = Date.now() + timeout;
	/* eslint-disable no-await-in-loop -- Poll only during bounded cancellation, never normal execution. */
	while (groupExists(pid)) {
		if (Date.now() >= deadline) {
			return false;
		}
		await Bun.sleep(INTERVAL);
	}
	/* eslint-enable no-await-in-loop */
	return true;
}
/** Read one PID, including the group needed to reject an unsafe signal target. */
async function readProcess(
	pid: number,
): Promise<{ process: Fingerprint; group: number } | undefined> {
	if (!signalProcess(pid, PROBE)) {
		return;
	}
	const child = Bun.spawn(["ps", "-p", String(pid), "-o", "pid=,ppid=,pgid=,lstart=,args="], {
		env: { ...process.env, LC_ALL: "C", LANG: "C" },
		stderr: "pipe",
		stdout: "pipe",
	});
	const [output, error, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code === ABSENT && output.trim() === "" && error.trim() === "") {
		return;
	}
	if (code !== SUCCESS) {
		throw new Error(`Cannot inspect PID ${pid}: ps exited ${code}: ${error}`);
	}
	return parseProcess(output);
}
