import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
// eslint-disable-next-line import/no-nodejs-modules -- Visible project configuration stays checkout-relative.
import { isAbsolute, join } from "node:path";
import { parse, stringify } from "smol-toml";
import type { AST } from "toml-eslint-parser";
import type { WorkspaceIO } from "./services.ts";
import { renderPrime } from "./prime.ts";
import { z } from "zod";

const NONEMPTY = 1;
const FIRST = 0;
const SECOND = 1;
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
export const onboardingSchema = z.strictObject({
	harnesses: z.array(z.enum(["claude", "codex", "pi"])).nonempty(),
	include: z.array(z.string()),
	exclude: z.array(z.string()),
});
export type OnboardingConfig = z.infer<typeof onboardingSchema>;
export const configSchema = z.strictObject({
	bootstrap: z.strictObject({ hooks: hookAdapterSchema }),
	hooks: hooksSchema,
	onboarding: onboardingSchema.optional(),
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
	const path = join(root, configPath);
	if (!(await io.exists(path))) {
		return undefined;
	}
	const contents = await io.read(path);
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

// eslint-disable-next-line max-statements -- Preserve user syntax through one ordered range-edit plan.
export async function writeProjectConfig(
	root: string,
	config: ProjectConfig,
	io: WorkspaceIO,
): Promise<void> {
	const path = join(root, configPath);
	if (!(await io.exists(path))) {
		await io.write(path, stringify(config));
		return;
	}
	const current = await io.read(path);
	const saved = await readProjectConfig(root, io);
	if (Bun.deepEquals(saved, config)) {
		return;
	}
	const ast = parseTOML(current, { tomlVersion: "1.1.0" });
	const edits: { start: number; end: number; text: string }[] = [];
	for (const entry of ast.body[FIRST].body) {
		if (entry.type === "TOMLTable") {
			if (entry.resolvedKey[FIRST] === "onboarding" && !config.onboarding) {
				edits.push({
					start: entry.range[FIRST],
					end: current.indexOf("]", entry.key.range[SECOND]) + SECOND,
					text: "",
				});
				for (const node of entry.body) {
					edits.push({ start: node.range[FIRST], end: node.range[SECOND], text: "" });
				}
			} else {
				edits.push(...editConfigValues(entry.body, entry.resolvedKey.map(String), config));
			}
		} else if (getStaticTOMLValue(entry.key)[FIRST] === "onboarding" && !config.onboarding) {
			edits.push({ start: entry.range[FIRST], end: entry.range[SECOND], text: "" });
		} else {
			edits.push(...editConfigValues([entry], [], config));
		}
	}
	let next = current;
	for (const edit of edits.toSorted((left, right) => right.start - left.start)) {
		next = next.slice(FIRST, edit.start) + edit.text + next.slice(edit.end);
	}
	if (!saved?.onboarding && config.onboarding) {
		if (!next.endsWith("\n")) {
			next += "\n";
		}
		next += stringify({ onboarding: config.onboarding });
	}
	await io.write(path, next);
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

export function digestConfig(config: ProjectConfig): string {
	return new Bun.CryptoHasher("sha256")
		.update(
			JSON.stringify({
				bootstrap: config.bootstrap,
				hooks: config.hooks,
				onboarding: config.onboarding,
			}),
		)
		.digest("hex");
}

// --- Private functions ---

function editConfigValues(
	entries: AST.TOMLKeyValue[],
	prefix: string[],
	config: ProjectConfig,
): { start: number; end: number; text: string }[] {
	return entries.flatMap((entry) => {
		const path = [...prefix, ...getStaticTOMLValue(entry.key)];
		if (entry.value.type === "TOMLInlineTable") {
			return editConfigValues(entry.value.body, path, config);
		}
		const desired = path.reduce<unknown>(
			(value, key) => (value as Record<string, unknown>)[key],
			config,
		);
		if (Bun.deepEquals(getStaticTOMLValue(entry.value), desired)) {
			return [];
		}
		return [
			{
				start: entry.value.range[FIRST],
				end: entry.value.range[SECOND],
				text: JSON.stringify(desired),
			},
		];
	});
}
