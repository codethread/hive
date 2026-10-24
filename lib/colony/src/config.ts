import type { BeeKind, BeesConfig } from "@hive/shared";
import { beesConfigSchema, kindSchema, validateBeesConfig } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Configuration discovery stays at the filesystem boundary.
import { readFile, readdir } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve canonical config and sibling prompt paths.
import { join } from "node:path";
import { z } from "zod";

const NONEMPTY = 1;
const fileNameSchema = z.object({ name: z.string().min(NONEMPTY) }).catchall(z.unknown());
const liveFiles: ConfigFiles = { directories: kindDirectories, readText };

export interface ConfigFiles {
	/** Read UTF-8 text; missing files reject with ENOENT. */
	readText: (path: string) => Promise<string>;
	/** List immediate kind folders; only an absent directory means an empty list. */
	directories: (path: string) => Promise<string[]>;
}
export interface LoadedBeesConfig {
	/** Canonical policy and effective kind definitions. */
	config: BeesConfig;
	/** Central definitions that shadow folder definitions, for bee kinds presentation. */
	warnings: string[];
}
export interface ConfigSource {
	/** Central policy and inline kinds before precedence resolution. */
	config: BeesConfig;
	/** Canonical file path for diagnostics. */
	source: string;
}
export interface KindSource {
	/** Declared kind name, independent of its folder name. */
	name: string;
	/** Folder kind with sibling prompt text included. */
	kind: BeeKind;
	/** Folder definition path for diagnostics. */
	source: string;
}

/** Load canonical configuration and kind folders once for every Bee/Colony consumer. */
export async function loadBeesConfig(
	root: string,
	files: ConfigFiles = liveFiles,
): Promise<LoadedBeesConfig> {
	const path = join(root, ".hive", "bees.toml");
	const config = await fromFile(path, async () => {
		const text = await files.readText(path).catch((error: unknown) => {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				throw new Error(
					"Canonical Colony configuration is missing. Run colony init --help to create .hive/bees.toml.",
					{ cause: error },
				);
			}
			throw error;
		});
		return beesConfigSchema.parse(Bun.TOML.parse(text));
	});
	const directory = join(root, ".hive", "bees");
	const folders = await files.directories(directory);
	const definitions = await Promise.all(
		folders.toSorted().map(async (folder) => {
			const source = join(directory, folder, "bee.toml");
			const definition = await readKind(source, join(directory, folder), files);
			return { kind: definition.kind, name: definition.name, source };
		}),
	);
	return resolveBeesConfig({ config, source: path }, definitions);
}

/**
 * Resolve schema-validated, defaulted inputs with definitions in loader-sorted folder order.
 * Central kinds win whole; selectors and formulas are validated once on the merged result.
 * Return new config/kinds records without mutating inputs.
 */
// eslint-disable-next-line max-statements -- Keep precedence, source diagnostics and effective validation together.
export function resolveBeesConfig(
	central: ConfigSource,
	definitions: readonly KindSource[],
): LoadedBeesConfig {
	const config = { ...central.config, kinds: { ...central.config.kinds } };
	const centralNames = new Set(Object.keys(config.kinds));
	const sources = new Map<string, string>();
	const warnings: string[] = [];
	for (const { name, kind, source } of definitions) {
		if (centralNames.has(name)) {
			warnings.push(`${central.source} overrides bee kind ${name} from ${source}`);
		} else {
			const previous = sources.get(name);
			if (previous !== undefined) {
				throw new Error(`Duplicate bee kind ${name}: ${previous} and ${source}`);
			}
			sources.set(name, source);
			config.kinds = { ...config.kinds, [name]: kind };
		}
	}
	validateBeesConfig(config);
	return { config, warnings };
}

// --- Private functions ---
function readKind(path: string, directory: string, files: ConfigFiles) {
	return fromFile(path, async () => {
		const { name, ...fields } = fileNameSchema.parse(Bun.TOML.parse(await files.readText(path)));
		if (Object.hasOwn(fields, "prompt") || Object.hasOwn(fields, "system_prompt")) {
			throw new Error(
				"Folder definitions use sibling prompt.md and system_prompt.md, not inline prompts",
			);
		}
		const [prompt, system_prompt] = await Promise.all([
			readPrompt(join(directory, "prompt.md"), files),
			readPrompt(join(directory, "system_prompt.md"), files),
		]);
		return { kind: kindSchema.parse({ ...fields, prompt, system_prompt }), name };
	});
}
function readPrompt(path: string, files: ConfigFiles): Promise<string> {
	return fromFile(path, async () => {
		try {
			return await files.readText(path);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return "";
			}
			throw error;
		}
	});
}
async function fromFile<Value>(path: string, read: () => Promise<Value>): Promise<Value> {
	try {
		return await read();
	} catch (error) {
		throw new Error(`Cannot load ${path}: ${String(error)}`, { cause: error });
	}
}
function readText(path: string): Promise<string> {
	return readFile(path, "utf8");
}
async function kindDirectories(path: string): Promise<string[]> {
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}
