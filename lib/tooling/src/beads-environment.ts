// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { basename, dirname, isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";

const databaseSchema = z.string().refine((value) => {
	const parent = dirname(value);
	return isAbsolute(value) && basename(value) === "beads.db" && basename(parent) === ".beads";
}, "BEADS_DB must be an absolute path to the tracker checkout's .beads/beads.db");
const minimumTextLength = 1;
const miseDirectivesSchema = z.looseObject({ path: z.array(z.string()).optional() });
const miseDirectiveKey = "_";
const miseEnvironmentSchema = z.looseObject({
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
const environmentSchema = z.object({
	BEADS_DB: databaseSchema,
	HIVE_BR_BIN: z.string().refine(isAbsolute, "HIVE_BR_BIN must select the native br executable"),
	PATH: z.string().min(minimumTextLength),
});
type TrackerEnvironment = z.infer<typeof environmentSchema>;
const parseEnvironment = (value: unknown): TrackerEnvironment => environmentSchema.parse(value);

const trackerRoot = (database: string): string => dirname(dirname(database));
const wrapperDirectory = (database: string): string =>
	join(trackerRoot(database), "scripts/beads/bin");

const configureEnvironment = (
	database: string,
	native: string,
	path: string,
): TrackerEnvironment => {
	const directory = wrapperDirectory(database);
	return parseEnvironment({
		BEADS_DB: database,
		HIVE_BR_BIN: native,
		PATH: [directory, ...path.split(":").filter((entry) => entry !== directory)].join(":"),
	});
};

const parseConfig = (contents: string): unknown => parse(contents, { integersAsBigInt: true });
const renderConfig = (config: object): string => stringify(config, { numbersAsFloat: true });

const renderMiseConfig = (contents: string, environment: TrackerEnvironment): string => {
	const config = miseSchema.parse(parseConfig(contents));
	const directory = wrapperDirectory(environment.BEADS_DB);
	const paths = config.env?._?.path ?? [];
	return renderConfig({
		...config,
		env: {
			...config.env,
			BEADS_DB: environment.BEADS_DB,
			HIVE_BR_BIN: environment.HIVE_BR_BIN,
			[miseDirectiveKey]: {
				...config.env?._,
				path: [directory, ...paths.filter((entry) => entry !== directory)],
			},
		},
		settings: { ...config.settings, activate_aggressive: true },
	});
};

const renderCodexConfig = (contents: string, environment: TrackerEnvironment): string => {
	const config = codexSchema.parse(parseConfig(contents));
	const policy = config.shell_environment_policy;
	return renderConfig({
		...config,
		allow_login_shell: false,
		shell_environment_policy: {
			...policy,
			set: { ...policy?.set, ...environment },
		},
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
	const environment = parseEnvironment(JSON.parse(output));
	return configureEnvironment(environment.BEADS_DB, environment.HIVE_BR_BIN, environment.PATH);
};

export {
	configureEnvironment,
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
