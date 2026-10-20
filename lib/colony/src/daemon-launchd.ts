import { z } from "zod";

const SUCCESS = 0;
const SERVICE_NOT_FOUND = 113;
const FIRST = 0;

export interface LaunchctlResult {
	/** Native command exit status. */
	code: number;
	/** Native command standard output. */
	stdout: string;
	/** Native command diagnostic output. */
	stderr: string;
}
export type Launchctl = (args: string[]) => Promise<LaunchctlResult>;
export type LaunchdStatus = { kind: "absent" } | { kind: "loaded"; pid: number | undefined };

/** Address the selected GUI domain independently of the caller's bootstrap context. */
export async function prepareLaunchdServer(service: string, run: Launchctl): Promise<void> {
	const domain = service.slice(FIRST, service.lastIndexOf("/"));
	const result = await run(["print", domain]);
	if (result.code !== SUCCESS) {
		throw new Error(
			`Independent Colony startup requires the macOS GUI launchd domain ${domain}; ` +
				`headless startup is not configured. launchctl print failed (${result.code}): ${result.stderr}`,
		);
	}
}

/** Inspect the exact selected service rather than the caller's implicit service list. */
export async function launchdServiceStatus(
	service: string,
	run: Launchctl,
): Promise<LaunchdStatus> {
	const result = await run(["print", service]);
	if (result.code === SERVICE_NOT_FOUND) {
		return { kind: "absent" };
	}
	if (result.code !== SUCCESS) {
		throw new Error(`Cannot inspect ${service} (${result.code}): ${result.stderr}`);
	}
	const pid = /^\tpid = (?<pid>\S+)$/mu.exec(result.stdout)?.groups?.["pid"];
	if (pid === undefined) {
		return { kind: "loaded", pid: undefined };
	}
	return { kind: "loaded", pid: z.coerce.number().int().positive().parse(pid) };
}

/** Live launchctl adapter, composed at the Colony CLI entry point. */
export async function launchctlResult(args: string[]): Promise<LaunchctlResult> {
	const child = Bun.spawn(["/bin/launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}
