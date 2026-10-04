// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { basename, dirname, isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";

const databaseSchema = z.string().refine((value) => {
	const parent = dirname(value);
	return isAbsolute(value) && basename(value) === "beads.db" && basename(parent) === ".beads";
}, "BEADS_DB must be an absolute path to the tracker checkout's .beads/beads.db");
const miseDirectiveKey = "_";
const miseDirectivesSchema = z.looseObject({ path: z.array(z.string()).optional() });
const miseEnvironmentSchema = z.looseObject({
	BEADS_DB: z.string().optional(),
	[miseDirectiveKey]: miseDirectivesSchema.optional(),
});
const miseSettingsSchema = z.looseObject({ activate_aggressive: z.boolean().optional() });
const miseSchema = z.looseObject({
	env: miseEnvironmentSchema.optional(),
	settings: miseSettingsSchema.optional(),
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
	// Retire generated interception settings when an existing checkout reruns setup.
	delete env.HIVE_BR_BIN;
	const wrapper = join(trackerRoot(env.BEADS_DB ?? environment.BEADS_DB), "scripts/beads/bin");
	if (env._?.path?.includes(wrapper)) {
		env._.path = env._.path.filter((entry) => entry !== wrapper);
		if (config.settings) {
			delete config.settings.activate_aggressive;
		}
	}
	return renderConfig({ ...config, env: { ...env, ...environment } });
}

export function renderCodexConfig(contents: string, environment: TrackerEnvironment): string {
	const config = codexSchema.parse(parseConfig(contents));
	const policy = config.shell_environment_policy ?? {};
	const set = policy.set ?? {};
	if (set.HIVE_CODEX_USER_ZDOTDIR !== undefined) {
		set.ZDOTDIR = set.HIVE_CODEX_USER_ZDOTDIR;
		delete set.HIVE_CODEX_USER_ZDOTDIR;
		delete set.PATH;
		delete config.allow_login_shell;
	}
	delete set.HIVE_BR_BIN;
	return renderConfig({
		...config,
		shell_environment_policy: { ...policy, set: { ...set, ...environment } },
	});
}

export async function runCommand(argv: readonly string[], cwd: string): Promise<string> {
	const child = Bun.spawn([...argv], { cwd, stderr: "inherit", stdout: "pipe" });
	const output = await new Response(child.stdout).text();
	const exitCode = await child.exited;
	if (exitCode !== EXIT_SUCCESS) {
		throw new Error(`${argv.join(" ")} failed (${exitCode})\n${output}`);
	}
	return output.trim();
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
