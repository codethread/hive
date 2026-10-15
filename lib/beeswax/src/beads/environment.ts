// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { basename, dirname, isAbsolute } from "node:path";
import { parse, stringify } from "smol-toml";
import { CommandError } from "@hive/beads";
import { z } from "zod";

const databaseSchema = z.string().refine((value) => {
	const parent = dirname(value);
	return isAbsolute(value) && basename(value) === "beads.db" && basename(parent) === ".beads";
}, "BEADS_DB must be an absolute path to the tracker checkout's .beads/beads.db");
const miseSchema = z.looseObject({
	env: z.looseObject({ BEADS_DB: z.string().optional() }).optional(),
});
const codexPolicySchema = z.looseObject({ set: z.record(z.string(), z.string()).optional() });
const codexSchema = z.looseObject({
	allow_login_shell: z.boolean().optional(),
	shell_environment_policy: codexPolicySchema.optional(),
});

const environmentSchema = z.object({ BEADS_DB: databaseSchema });
const EXIT_SUCCESS = 0;

/** Repository-maintenance subprocess boundary; failed commands retain their diagnostics. */
export type Command = (argv: readonly string[], cwd: string) => Promise<string>;

export interface TrackerEnvironment {
	/** Absolute path to the selected tracker database. */
	BEADS_DB: string;
}

export function parseDatabase(value: unknown): string {
	return databaseSchema.parse(value);
}

export function parseEnvironment(value: unknown): TrackerEnvironment {
	return environmentSchema.parse(value);
}

export function trackerRoot(database: string): string {
	return dirname(dirname(database));
}

export function renderMiseConfig(contents: string, environment: TrackerEnvironment): string {
	const config = miseSchema.parse(parseConfig(contents));
	const env = config.env ?? {};
	return renderConfig({ ...config, env: { ...env, ...environment } });
}

export function renderCodexConfig(contents: string, environment: TrackerEnvironment): string {
	const config = codexSchema.parse(parseConfig(contents));
	const policy = config.shell_environment_policy ?? {};
	const set = policy.set ?? {};
	return renderConfig({
		...config,
		shell_environment_policy: { ...policy, set: { ...set, ...environment } },
	});
}

/** Retain both streams even when native JSON supplies the primary error diagnostic. */
export class CapturedCommandError extends CommandError {
	/** Captured child diagnostics for structured CLI failure output. */
	readonly stderr: string;
	constructor(command: string, result: { code: number; stdout: string; stderr: string }) {
		super(command, result);
		this.name = "CapturedCommandError";
		this.stderr = result.stderr;
	}
}

export async function runCommand(
	argv: readonly string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const child = Bun.spawn([...argv], { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== EXIT_SUCCESS) {
		throw new CapturedCommandError(argv.join(" "), { code, stderr, stdout });
	}
	return stdout.trim();
}

export async function resolveEnvironment(
	cwd: string,
	command: Command,
): Promise<TrackerEnvironment> {
	const output = await command(["mise", "env", "--json"], cwd);
	return parseEnvironment(JSON.parse(output));
}

// -----------------------------------------------------------------------------

function parseConfig(contents: string): unknown {
	return parse(contents, { integersAsBigInt: true });
}

function renderConfig(config: object): string {
	return stringify(config, { numbersAsFloat: true });
}
