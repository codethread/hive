import type { DaemonSupervisor } from "./daemon-lifecycle.ts";
import type { ServerTarget } from "./client.ts";
import { daemonEnvironment } from "./daemon-environment.ts";
import { entryCommand } from "./executables.ts";
// eslint-disable-next-line import/no-nodejs-modules -- State-local unit and log paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Create the selected native service directory.
import { mkdir } from "node:fs/promises";
import { z } from "zod";

const SUCCESS = 0;
const NO_PROCESS = 0;
const FIRST = 0;
const WITHOUT_QUOTES_START = 1;
const WITHOUT_QUOTES_END = -1;
const mainPidSchema = z.coerce.number().int().nonnegative();

/** Check access to the systemd user manager before stopping a working daemon. */
export async function prepareSystemdServer(): Promise<void> {
	await systemctl(["show-environment"]);
}

/** Start a runtime-linked unit with process-only cleanup so detached bees survive. */
// eslint-disable-next-line max-statements -- Keep native service side effects and their receipts together.
export async function startSystemdServer(
	target: ServerTarget,
	supervisor: DaemonSupervisor,
	effect: (value: string) => Promise<void>,
): Promise<DaemonSupervisor> {
	const pid = await systemdMainPid(supervisor);
	if (pid !== NO_PROCESS) {
		throw new Error(
			`Native service still has PID ${pid}; wait for verified exit before restarting: ${supervisor.service}`,
		);
	}
	await mkdir(target.state, { mode: 0o700, recursive: true });
	const path = join(target.state, supervisor.service);
	const log = join(target.state, "daemon.log");
	const argv = [
		...entryCommand(target.runtimeEntry),
		"serve",
		"--socket",
		target.socket,
		"--state",
		target.state,
	];
	const unit = `[Unit]
Description=Colony daemon
[Service]
Type=exec
ExecStart=${argv.map((value) => unitWord(value.replaceAll("$", "$$"))).join(" ")}
WorkingDirectory=${unitPath(target.state)}
${Object.entries(daemonEnvironment(process.env))
	.map(([name, value]) => `Environment=${unitWord(`${name}=${value}`)}`)
	.join("\n")}
StandardOutput=append:${unitPath(log)}
StandardError=append:${unitPath(log)}
KillMode=process
Restart=no
`;
	await Bun.write(path, unit, { mode: 0o600 });
	await systemctl(["--runtime", "link", path]);
	await effect("native_service_linked");
	await systemctl(["daemon-reload"]);
	await systemctl(["start", supervisor.service]);
	await effect("native_service_submitted");
	return supervisor;
}

/** Read the unit's main PID, verifying process-only cleanup while it is running. */
// eslint-disable-next-line max-statements -- Inspect native load, main-process and cleanup policy facts together.
export async function systemdMainPid(supervisor: DaemonSupervisor): Promise<number> {
	const result = await systemctlResult([
		"show",
		supervisor.service,
		"--property=LoadState",
		"--property=MainPID",
		"--property=KillMode",
	]);
	const fields = Object.fromEntries(
		result.stdout
			.trim()
			.split("\n")
			.map((line) => line.split("=")),
	);
	if (fields["LoadState"] === "not-found") {
		return NO_PROCESS;
	}
	if (
		result.code !== SUCCESS ||
		(fields["LoadState"] !== "loaded" && fields["LoadState"] !== "bad-setting")
	) {
		throw new Error(`Cannot inspect ${supervisor.service}: ${result.stderr}`);
	}
	const pid = mainPidSchema.parse(fields["MainPID"]);
	if (pid === NO_PROCESS) {
		return pid;
	}
	if (fields["KillMode"] !== "process") {
		throw new Error(
			`Native service requires KillMode=process to preserve detached bees: ${supervisor.service}`,
		);
	}
	return pid;
}

// --- Private functions ---
async function systemctl(args: string[]): Promise<void> {
	const result = await systemctlResult(args);
	if (result.code !== SUCCESS) {
		throw new Error(`systemctl --user ${args[FIRST]} failed (${result.code}): ${result.stderr}`);
	}
}
async function systemctlResult(args: string[]) {
	const child = Bun.spawn(["systemctl", "--user", ...args], { stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}
function unitWord(value: string): string {
	return JSON.stringify(value).replaceAll("%", "%%");
}

function unitPath(value: string): string {
	return JSON.stringify(value)
		.slice(WITHOUT_QUOTES_START, WITHOUT_QUOTES_END)
		.replaceAll("%", "%%");
}
