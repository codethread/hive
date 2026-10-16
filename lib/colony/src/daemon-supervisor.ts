/* eslint-disable import/max-dependencies -- Native supervisor composes process, filesystem and wire evidence. */
import type { DaemonStatus, DaemonSupervisor, RestartCheckpoint } from "./daemon-lifecycle.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native service files and ownership receipts.
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { observeProcess, processFingerprintSchema } from "./processes.ts";
import { prepareSystemdServer, startSystemdServer, systemdMainPid } from "./daemon-systemd.ts";
import { Database } from "bun:sqlite";
import type { ServerTarget } from "./client.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Runtime preflight verifies executable and source access.
import { constants } from "node:fs";
// eslint-disable-next-line import/no-nodejs-modules -- Hash the selected state into a native service label.
import { createHash } from "node:crypto";
import { daemonStopResponseSchema } from "@hive/shared";
import { entryCommand } from "./executables.ts";
// eslint-disable-next-line import/no-nodejs-modules -- State-local supervisor files.
import { join } from "node:path";
import { z } from "zod";

const SUCCESS = 0;
const FIRST = 0;
const ONE = 1;
const NO_PID = "-";
const HASH_LENGTH = 20;
const LAUNCHD_PID = 1;
const pendingSchema = z.object({
	state: z.enum(["running", "failed", "done"]),
	registrations: daemonStopResponseSchema.shape.registrations.nullable(),
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
export async function readDaemonHandoff(target: ServerTarget) {
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
	if ((await observeProcess(owner.process)) !== "stopped") {
		throw new Error(
			"The prior daemon is still running; retain its handoff and wait for verified exit",
		);
	}
	return handoff;
}

/** An unfinished restart's manifest stays authoritative until its recovery checks pass. */
export async function readPendingRestart(target: ServerTarget) {
	const source = await readOptionalJson(join(target.state, "restart.json"));
	if (source === undefined) {
		return;
	}
	const pending = pendingSchema.parse(source);
	if (pending.state !== "done" && pending.registrations !== null) {
		return pending.registrations;
	}
	// eslint-disable-next-line unicorn/no-useless-undefined -- Explicit return preserves the optional result type.
	return undefined;
}

/** Reject unavailable native ownership before asking a working daemon to stop. */
// eslint-disable-next-line max-statements -- Preflight platform ownership and executable requirements before stop.
export async function prepareSupervisedServer(target: ServerTarget): Promise<void> {
	const supervisor = selectedSupervisor(target);
	if (supervisor.kind === "systemd") {
		await prepareSystemdServer();
	} else {
		const manager = await launchctlResult(["managername"]);
		if (manager.code !== SUCCESS || manager.stdout.trim() !== "Aqua") {
			throw new Error(
				"Independent Colony startup requires the macOS GUI launchd domain; headless startup is not configured",
			);
		}
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
): Promise<DaemonSupervisor> {
	const supervisor = selectedSupervisor(target);
	if (supervisor.kind === "systemd") {
		return startSystemdServer(target, supervisor, effect);
	}
	const loaded = await serviceStatus(supervisor);
	if (loaded.kind === "loaded") {
		if (loaded.pid !== undefined) {
			throw new Error(
				`Native service still has PID ${loaded.pid}; refusing live bootout: ${supervisor.service}`,
			);
		}
		await launchctl(["bootout", supervisor.service]);
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
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env["PATH"]!)}</string></dict>
<key>WorkingDirectory</key><string>${xml(target.state)}</string>
<key>RunAtLoad</key><true/>
<key>AbandonProcessGroup</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`;
	await Bun.write(path, contents, { mode: 0o600 });
	await launchctl([
		"bootstrap",
		supervisor.service.slice(FIRST, supervisor.service.lastIndexOf("/")),
		path,
	]);
	await effect("native_service_submitted");
	return supervisor;
}

/** Verify that the selected native supervisor owns this exact ready daemon. */
export async function verifySupervisedServer(
	target: ServerTarget,
	status: DaemonStatus,
	supervisor: DaemonSupervisor,
): Promise<void> {
	const owner = await readDaemonOwner(target, status);
	if (supervisor.kind === "systemd") {
		if ((await systemdMainPid(supervisor)) !== owner.pid) {
			throw new Error(`Daemon is not owned by ${supervisor.service}`);
		}
	} else {
		const loaded = await serviceStatus(supervisor);
		if (owner.ppid !== LAUNCHD_PID || loaded.kind !== "loaded" || loaded.pid !== owner.pid) {
			throw new Error(`Daemon is not independently owned by ${supervisor.service}`);
		}
	}
	if ((await observeProcess(owner)) !== "live") {
		throw new Error("Native daemon lifetime ended before verification");
	}
}

// --- Private functions ---
function selectedSupervisor(target: ServerTarget): DaemonSupervisor {
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
// eslint-disable-next-line max-statements -- Parse the documented legacy list columns for the selected service only.
async function serviceStatus(
	supervisor: DaemonSupervisor,
): Promise<{ kind: "absent" } | { kind: "loaded"; pid: number | undefined }> {
	const result = await launchctlResult(["list"]);
	if (result.code !== SUCCESS) {
		throw new Error(`Cannot list native services: ${result.stderr}`);
	}
	const label = supervisor.service.slice(supervisor.service.lastIndexOf("/") + ONE);
	const row = result.stdout
		.split("\n")
		.map((line) => line.trim().split(/\s+/u))
		.find((fields) => fields.at(-ONE) === label);
	if (row === undefined) {
		return { kind: "absent" };
	}
	const pid = row[FIRST];
	if (pid === NO_PID) {
		return { kind: "loaded", pid: undefined };
	}
	return { kind: "loaded", pid: z.coerce.number().int().positive().parse(pid) };
}
async function launchctl(args: string[]): Promise<void> {
	const result = await launchctlResult(args);
	if (result.code !== SUCCESS) {
		throw new Error(`launchctl ${args[FIRST]} failed (${result.code}): ${result.stderr}`);
	}
}
async function launchctlResult(args: string[]) {
	const child = Bun.spawn(["/bin/launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
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
