/* eslint-disable import/max-dependencies -- Native supervisor composes process, filesystem and wire evidence. */
import type {
	ContinuationEvidence,
	DaemonStatus,
	DaemonSupervisor,
	RestartCheckpoint,
} from "./daemon-lifecycle.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native service files and ownership receipts.
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { daemonStatusResponseSchema, daemonStopResponseSchema } from "@hive/shared";
import { launchdServiceStatus, prepareLaunchdServer } from "./daemon-launchd.ts";
import { observeProcess, processFingerprintSchema } from "./processes.ts";
import { prepareSystemdServer, startSystemdServer, systemdMainPid } from "./daemon-systemd.ts";
import { Database } from "bun:sqlite";
import type { Launchctl } from "./daemon-launchd.ts";
import type { ServerTarget } from "./client.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Runtime preflight verifies executable and source access.
import { constants } from "node:fs";
// eslint-disable-next-line import/no-nodejs-modules -- Hash the selected state into a native service label.
import { createHash } from "node:crypto";
import { daemonEnvironment } from "./daemon-environment.ts";
import { entryCommand } from "./executables.ts";
// eslint-disable-next-line import/no-nodejs-modules -- State-local supervisor files.
import { join } from "node:path";
import { z } from "zod";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const HASH_LENGTH = 20;
const LAUNCHD_PID = 1;
const outgoingSchema = z.object({
	id: z.string(),
	pid: z.number().int().positive(),
	owner: processFingerprintSchema,
});
const continuationEvidence = z.object({
	outgoing: outgoingSchema,
	confirmedEffects: z.array(z.string()),
	stopFailure: z
		.object({ phase: z.enum(["transport", "response", "decode", "daemon"]), message: z.string() })
		.optional(),
});
/** Persisted form of RestartContinuation; the lifecycle type owns phase semantics. */
const continuationSchema = z.discriminatedUnion("phase", [
	continuationEvidence.extend({ phase: z.literal("prepared") }),
	continuationEvidence.extend({ phase: z.literal("stop_requested") }),
	continuationEvidence.extend({ phase: z.literal("drained"), handoff: daemonStopResponseSchema }),
	continuationEvidence.extend({
		phase: z.literal("start_requested"),
		handoff: daemonStopResponseSchema,
	}),
	continuationEvidence.extend({
		phase: z.literal("observed"),
		handoff: daemonStopResponseSchema,
		daemon: daemonStatusResponseSchema,
	}),
]);
const pendingSchema = z.object({
	/** Retained restart disposition; only unfinished checkpoints can resume. */
	state: z.enum(["running", "failed", "done"]),
	/** Original durable membership and attempt manifest, absent before handoff. */
	registrations: daemonStopResponseSchema.shape.registrations.nullable(),
	/** Original daemon identity and process ownership, absent when unobserved. */
	previous: z
		.object({
			/** Original daemon lifetime identifier. */
			id: z.string(),
			/** Original daemon process identifier. */
			pid: z.number().int().positive(),
			/** Process fingerprint used to prove the original daemon exited. */
			owner: processFingerprintSchema,
		})
		.nullable(),
	/** Observed replacement, absent before readiness; its recovery may still be incomplete. */
	daemon: daemonStatusResponseSchema.nullable(),
	/** Confirmed restart effects in their original order. */
	confirmedEffects: z.array(z.string()),
	/** Additional replacement leg retained beside the original evidence. */
	continuation: continuationSchema.optional(),
	/** Endpoint selected when this restart was recorded. */
	target: z.object({
		/** Selected absolute Unix socket path. */
		socket: z.string(),
		/** Selected absolute daemon state directory. */
		state: z.string(),
	}),
});
const ownerSchema = z.object({
	id: z.string(),
	process: processFingerprintSchema,
	socket: z.string(),
});

/** Read only the receipt for the exact daemon observed on the selected endpoint. */
export async function readDaemonOwner(target: ServerTarget, status: DaemonStatus) {
	const source = await readFile(join(target.state, "daemon.json"), "utf8");
	const owner = ownerSchema.parse(JSON.parse(source));
	if (
		owner.id !== status.id ||
		owner.process.pid !== status.pid ||
		owner.socket !== target.socket ||
		status.state !== target.state
	) {
		throw new Error("Daemon ownership receipt does not match the selected live daemon");
	}
	return owner.process;
}

/** Retained server handoffs permit deliberate recovery after an interrupted caller. */
// eslint-disable-next-line max-statements -- Match final handoff identity and prove its former owner is stopped.
export async function readDaemonHandoff(
	target: ServerTarget,
	expected?: ContinuationEvidence["outgoing"],
) {
	const source = await readOptionalJson(join(target.state, "daemon-handoff.json"));
	if (source === undefined) {
		return;
	}
	const handoff = daemonStopResponseSchema.parse(source);
	const ownerSource = await readFile(join(target.state, "daemon.json"), "utf8");
	const owner = ownerSchema.parse(JSON.parse(ownerSource));
	if (owner.id !== handoff.id) {
		return;
	}
	if (
		owner.socket !== target.socket ||
		(expected &&
			(owner.id !== expected.id ||
				owner.process.pid !== expected.pid ||
				owner.process.startTime !== expected.owner.startTime ||
				owner.process.ppid !== expected.owner.ppid ||
				owner.process.cmd !== expected.owner.cmd))
	) {
		throw new Error("Daemon handoff ownership does not match the selected outgoing process");
	}
	if ((await observeProcess(owner.process)) !== "stopped") {
		throw new Error(
			"The prior daemon is still running; retain its handoff and wait for verified exit",
		);
	}
	return handoff;
}

/** Read the complete unfinished restart checkpoint and require the same selected endpoint. */
export async function readPendingRestart(target: ServerTarget) {
	const source = await readOptionalJson(join(target.state, "restart.json"));
	if (source === undefined) {
		return;
	}
	const { target: recordedTarget, ...pending } = pendingSchema.parse(source);
	if (recordedTarget.socket !== target.socket || recordedTarget.state !== target.state) {
		throw new Error("Restart receipt does not match the selected endpoint");
	}
	if (pending.state !== "done") {
		return pending;
	}
	// eslint-disable-next-line unicorn/no-useless-undefined -- Explicit return preserves the optional result type.
	return undefined;
}

/** Reject unavailable native ownership before asking a working daemon to stop. */
// eslint-disable-next-line max-statements, unicorn/prefer-ternary -- Preflight platform and runtime before stop.
export async function prepareSupervisedServer(target: ServerTarget, run: Launchctl): Promise<void> {
	const supervisor = selectedSupervisor(target);
	// eslint-disable-next-line unicorn/prefer-ternary -- Select distinct native manager operations.
	if (supervisor.kind === "systemd") {
		await prepareSystemdServer();
	} else {
		await prepareLaunchdServer(supervisor.service, run);
	}
	const [executable, ...prefix] = entryCommand(target.runtimeEntry);
	await access(executable, constants.X_OK);
	if (prefix.length > FIRST) {
		await access(target.runtimeEntry, constants.R_OK);
	}
	z.string().min(ONE).parse(process.env["PATH"]);
}

/** Serialize lifecycle callers without retaining a stale lock after process exit. */
export async function withDaemonLock<Result>(
	target: ServerTarget,
	action: () => Promise<Result>,
): Promise<Result> {
	await mkdir(target.state, { mode: 0o700, recursive: true });
	const lock = new Database(join(target.state, "daemon-operation-lock.sqlite"), { create: true });
	try {
		lock.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
		return await action();
	} finally {
		lock.close();
	}
}

/** Retain original handoff data and confirmed phases independently of caller delivery. */
export async function recordRestart(
	target: ServerTarget,
	checkpoint: RestartCheckpoint,
): Promise<void> {
	const temporary = join(target.state, "restart.json.tmp");
	await Bun.write(
		temporary,
		JSON.stringify({ ...checkpoint, target: { socket: target.socket, state: target.state } }),
		{ mode: 0o600 },
	);
	await rename(temporary, join(target.state, "restart.json"));
}

/** Submit only an idle or absent native service; preserve live service processes. */
// eslint-disable-next-line max-statements -- Native submission keeps service removal and confirmed effects together.
export async function startSupervisedServer(
	target: ServerTarget,
	effect: (value: string) => Promise<void>,
	run: Launchctl,
): Promise<DaemonSupervisor> {
	const supervisor = selectedSupervisor(target);
	if (supervisor.kind === "systemd") {
		return startSystemdServer(target, supervisor, effect);
	}
	const loaded = await launchdServiceStatus(supervisor.service, run);
	if (loaded.kind === "loaded") {
		if (loaded.pid !== undefined) {
			throw new Error(
				`Native service still has PID ${loaded.pid}; refusing live bootout: ${supervisor.service}`,
			);
		}
		await launchctl(["bootout", supervisor.service], run);
		await effect("idle_service_removed");
	}
	await mkdir(target.state, { mode: 0o700, recursive: true });
	const path = join(target.state, "daemon.plist");
	const log = join(target.state, "daemon.log");
	const argv = [
		...entryCommand(target.runtimeEntry),
		"serve",
		"--socket",
		target.socket,
		"--state",
		target.state,
	];
	const label = supervisor.service.slice(supervisor.service.lastIndexOf("/") + ONE);
	const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${argv.map((argument) => `<string>${xml(argument)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(daemonEnvironment(process.env))
		.map(([name, value]) => `<key>${xml(name)}</key><string>${xml(value)}</string>`)
		.join("")}</dict>
<key>WorkingDirectory</key><string>${xml(target.state)}</string>
<key>RunAtLoad</key><true/>
<key>AbandonProcessGroup</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`;
	await Bun.write(path, contents, { mode: 0o600 });
	await launchctl(
		["bootstrap", supervisor.service.slice(FIRST, supervisor.service.lastIndexOf("/")), path],
		run,
	);
	await effect("native_service_submitted");
	return supervisor;
}

/** Verify that the selected native supervisor owns this exact ready daemon. */
// eslint-disable-next-line max-params -- The native command adapter is injected beside ownership evidence.
export async function verifySupervisedServer(
	target: ServerTarget,
	status: DaemonStatus,
	supervisor: DaemonSupervisor,
	run: Launchctl,
): Promise<void> {
	const owner = await readDaemonOwner(target, status);
	if (supervisor.kind === "systemd") {
		if ((await systemdMainPid(supervisor)) !== owner.pid) {
			throw new Error(`Daemon is not owned by ${supervisor.service}`);
		}
	} else {
		const loaded = await launchdServiceStatus(supervisor.service, run);
		if (owner.ppid !== LAUNCHD_PID || loaded.kind !== "loaded" || loaded.pid !== owner.pid) {
			throw new Error(`Daemon is not independently owned by ${supervisor.service}`);
		}
	}
	if ((await observeProcess(owner)) !== "live") {
		throw new Error("Native daemon lifetime ended before verification");
	}
}

/** Derive the native service target from the platform and selected state directory. */
export function selectedSupervisor(target: ServerTarget): DaemonSupervisor {
	const hash = createHash("sha256").update(target.state).digest("hex").slice(FIRST, HASH_LENGTH);
	if (process.platform === "linux") {
		return { kind: "systemd", service: `dev.hive.colony.${hash}.service` };
	}
	if (process.platform === "darwin" && process.getuid !== undefined) {
		return { kind: "launchd", service: `gui/${process.getuid()}/dev.hive.colony.${hash}` };
	}
	throw new Error(
		"Independent Colony startup requires macOS launchd or a Linux systemd user manager",
	);
}

// --- Private functions ---
async function launchctl(args: string[], run: Launchctl): Promise<void> {
	const result = await run(args);
	if (result.code !== SUCCESS) {
		throw new Error(`launchctl ${args[FIRST]} failed (${result.code}): ${result.stderr}`);
	}
}
function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

async function readOptionalJson(path: string): Promise<unknown> {
	const source = await readFile(path, "utf8").catch((error: unknown) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	});
	if (source !== undefined) {
		return JSON.parse(source);
	}
	// eslint-disable-next-line unicorn/no-useless-undefined -- Explicit return preserves the optional result type.
	return undefined;
}
