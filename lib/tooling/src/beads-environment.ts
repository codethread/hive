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

const parseDatabase = (value: unknown): string => databaseSchema.parse(value);
const environmentSchema = z.object({ BEADS_DB: databaseSchema });
type TrackerEnvironment = z.infer<typeof environmentSchema>;
const parseEnvironment = (value: unknown): TrackerEnvironment => environmentSchema.parse(value);
const trackerRoot = (database: string): string => dirname(dirname(database));
const parseConfig = (contents: string): unknown => parse(contents, { integersAsBigInt: true });
const renderConfig = (config: object): string => stringify(config, { numbersAsFloat: true });

const renderMiseConfig = (contents: string, environment: TrackerEnvironment): string => {
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
};

const renderCodexConfig = (contents: string, environment: TrackerEnvironment): string => {
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
};

/** Repository-maintenance subprocess boundary; failed commands retain their diagnostics. */
type Command = (argv: readonly string[], cwd: string) => Promise<string>;
const EXIT_SUCCESS = 0;

const runCommand: Command = async (argv, cwd) => {
	const child = Bun.spawn([...argv], { cwd, stderr: "inherit", stdout: "pipe" });
	const output = await new Response(child.stdout).text();
	const exitCode = await child.exited;
	if (exitCode !== EXIT_SUCCESS) {
		throw new Error(`${argv.join(" ")} failed (${exitCode})\n${output}`);
	}
	return output.trim();
};

const resolveEnvironment = async (cwd: string, command: Command): Promise<TrackerEnvironment> => {
	const output = await command(["mise", "env", "--json"], cwd);
	return parseEnvironment(JSON.parse(output));
};

export {
	parseDatabase,
	parseEnvironment,
	renderCodexConfig,
	renderMiseConfig,
	resolveEnvironment,
	runCommand,
	trackerRoot,
	type Command,
	type TrackerEnvironment,
};
