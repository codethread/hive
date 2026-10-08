import { beesConfigSchema, kindSchema, recipeSchema, validateBeesConfig } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Configuration discovery stays at the filesystem boundary.
import { readFile, readdir } from "node:fs/promises";
import type { BeesConfig } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve canonical config and sibling prompt paths.
import { join } from "node:path";
import { z } from "zod";

const NONEMPTY = 1;
const fileNameSchema = z.object({ name: z.string().min(NONEMPTY) }).catchall(z.unknown());
const liveFiles: ConfigFiles = { directories: kindDirectories, readText };

export interface ConfigFiles {
	/** Read a required UTF-8 configuration or prompt file. */
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

/** Load canonical configuration and kind folders once for every Bee/Colony consumer. */
// eslint-disable-next-line max-statements -- Keep source loading, precedence and diagnostics together at this IO boundary.
export async function loadBeesConfig(
	root: string,
	files: ConfigFiles = liveFiles,
): Promise<LoadedBeesConfig> {
	const path = join(root, ".hive", "bees.toml");
	const config = await fromFile(path, async () =>
		beesConfigSchema.parse(Bun.TOML.parse(await files.readText(path))),
	);
	const centralNames = new Set(Object.keys(config.kinds));
	const sources = new Map<string, string>();
	const warnings: string[] = [];
	const directory = join(root, ".hive", "bees");
	const folders = await files.directories(directory);
	const definitions = await Promise.all(
		folders.toSorted().map(async (folder) => {
			const source = join(directory, folder, "bee.toml");
			const definition = await readKind(source, join(directory, folder, "prompt.md"), files);
			return { kind: definition.kind, name: definition.name, source };
		}),
	);
	for (const { name, kind, source } of definitions) {
		if (centralNames.has(name)) {
			warnings.push(`${path} overrides bee kind ${name} from ${source}`);
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
function readKind(path: string, promptPath: string, files: ConfigFiles) {
	return fromFile(path, async () => {
		const { name, ...fields } = fileNameSchema.parse(Bun.TOML.parse(await files.readText(path)));
		if (Object.hasOwn(fields, "prompt")) {
			throw new Error("Folder definitions use sibling prompt.md, not an inline prompt");
		}
		const prompt = await fromFile(promptPath, async () =>
			recipeSchema.shape.prompt.parse(await files.readText(promptPath)),
		);
		return { kind: kindSchema.parse({ ...fields, prompt }), name };
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
