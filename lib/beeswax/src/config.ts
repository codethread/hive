import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Visible project configuration stays checkout-relative.
import { isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import type { OnboardingConfig } from "./onboarding.ts";
import type { WorkspaceIO } from "./services.ts";
import { onboardingSchema } from "./onboarding.ts";
import { renderPrime } from "./prime.ts";
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
	onboarding: onboardingSchema.optional(),
	beads: z.strictObject({ lock_timeout: z.number().int().nonnegative().safe() }).optional(),
});
export type ProjectConfig = z.infer<typeof configSchema>;
export const configPath = ".hive/beeswax/config.toml";

export interface OnboardingFlags {
	/** Harnesses receiving repository-local onboarding, or none to remove it. */
	harness?: readonly string[];
	/** Guidance added to the everyday set. */
	include?: readonly string[];
	/** Guidance removed after includes. */
	exclude?: readonly string[];
}

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

/** Resolve explicit onboarding selections while preserving unspecified project intent. */
// eslint-disable-next-line max-statements -- Keep selection and usage failures at the CLI boundary.
export function selectOnboardingConfig(
	config: ProjectConfig,
	flags: OnboardingFlags,
): ProjectConfig {
	const { onboarding, ...base } = config;
	const harnesses = [...new Set(flags.harness ?? onboarding?.harnesses)];
	if (harnesses.includes("none")) {
		if (harnesses.length !== NONEMPTY) {
			throw new BeeswaxError("usage", "--harness none cannot be combined with other harnesses.", {
				exitCode: EXIT.usage,
			});
		}
		return base;
	}
	if (harnesses.length < NONEMPTY) {
		if (flags.include !== undefined || flags.exclude !== undefined) {
			throw new BeeswaxError(
				"usage",
				"Choose an onboarding harness with --harness claude, --harness codex or --harness pi.",
				{ exitCode: EXIT.usage },
			);
		}
		return base;
	}
	const selected = onboardingSchema.safeParse({
		harnesses,
		include: flags.include ?? onboarding?.include ?? [],
		exclude: flags.exclude ?? onboarding?.exclude ?? [],
	});
	if (!selected.success) {
		throw new BeeswaxError("usage", "Unknown onboarding harness. Choose claude, codex or pi.", {
			exitCode: EXIT.usage,
		});
	}
	const result: OnboardingConfig = selected.data;
	renderPrime(result);
	return { ...base, onboarding: result };
}
