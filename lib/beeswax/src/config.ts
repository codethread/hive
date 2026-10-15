import { BeeswaxError, errorMessage } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Visible project configuration stays checkout-relative.
import { isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import type { WorkspaceIO } from "./services.ts";
import { z } from "zod";

const NONEMPTY = 1;
const pathSchema = z
	.string()
	.min(NONEMPTY)
	.refine(
		(path) => !isAbsolute(path) && !path.split(/[\\/]/u).includes(".."),
		"Hook paths must stay inside the checkout or its .git directory",
	);
export const hookAdapterSchema = z.enum(["husky", "git", "none"]);
export type HookAdapter = z.infer<typeof hookAdapterSchema>;
const hooksSchema = z.strictObject({ pre_commit: pathSchema, pre_merge_commit: pathSchema });
export const configSchema = z.strictObject({
	bootstrap: z.strictObject({ hooks: hookAdapterSchema }),
	hooks: hooksSchema,
});
export type ProjectConfig = z.infer<typeof configSchema>;
export const configPath = ".hive/beeswax/config.toml";

/** Pin each actual hook file; Beeswax does not infer an application's hook framework. */
export async function readProjectConfig(
	root: string,
	io: WorkspaceIO,
): Promise<ProjectConfig | undefined> {
	const contents = await io.read(join(root, configPath));
	if (contents === "") {
		return undefined;
	}
	try {
		return configSchema.parse(parse(contents));
	} catch (error) {
		throw new BeeswaxError(
			"migration_required",
			`Invalid ${configPath}: ${errorMessage(error)}. ` +
				'Run "beeswax migrate setup" with the user to agree the configuration.',
			{ context: { nextCommand: "beeswax migrate setup", requiresUser: true } },
		);
	}
}

export async function writeProjectConfig(
	root: string,
	config: ProjectConfig,
	io: WorkspaceIO,
): Promise<void> {
	await io.write(join(root, configPath), stringify(config));
}

export function defaultProjectConfig(adapter: HookAdapter): ProjectConfig {
	let directory = ".husky";
	if (adapter === "git") {
		directory = ".git/hooks";
	}
	return {
		bootstrap: { hooks: adapter },
		hooks: {
			pre_commit: `${directory}/pre-commit`,
			pre_merge_commit: `${directory}/pre-merge-commit`,
		},
	};
}

/** Reset hook paths only when switching to Husky or Git. */
export function selectHookConfig(config: ProjectConfig, adapter?: HookAdapter): ProjectConfig {
	if (adapter === undefined || adapter === config.bootstrap.hooks) {
		return config;
	}
	let { hooks } = config;
	if (adapter !== "none") {
		({ hooks } = defaultProjectConfig(adapter));
	}
	return { ...config, bootstrap: { hooks: adapter }, hooks };
}
