import { BusyBeeError, createServices } from "./native.ts";
// Pure path resolution keeps entries within their authoring folder.
// eslint-disable-next-line import/no-nodejs-modules
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Services } from "./native.ts";
import { workflowVersionSchema } from "./compatibility.ts";
import { z } from "zod";

export type Source =
	| {
			/** Explicit entry, fingerprinted by its own bytes. */
			kind: "file";
			/** Absolute entry module path. */
			source: string;
	  }
	| {
			/** Named definition, fingerprinted as a folder. */
			kind: "folder";
			/** Absolute entry module path. */
			source: string;
			/** Authoring folder containing manifest and local helpers. */
			directory: string;
	  };

const NONEMPTY = 1;
const FIRST = 0;
const nameSchema = z.compile(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u));
const manifestSchema = z.compile(
	z.strictObject({
		description: z.string().trim().min(NONEMPTY),
		run: z
			.string()
			.min(NONEMPTY)
			.regex(/\.(?:js|ts)$/u),
		version: workflowVersionSchema,
	}),
);

export async function listWorkflows(
	directory: string | undefined,
	services: Services = createServices(),
) {
	const repo = await repositoryRoot(directory ?? services.cwd, services);
	const entries = await services.readDirectory(join(repo, ".workflows")).catch((error) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	const names = entries
		.filter((entry) => entry.kind === "directory")
		.map((entry) => entry.name)
		.toSorted();
	const workflows = await Promise.all(
		names.map(async (name) => {
			const definition = await readManifest(repo, name, services);
			return definition.metadata;
		}),
	);
	return { repo, workflows };
}

export async function namedDefinition(
	name: string,
	directory: string | undefined,
	services: Services = createServices(),
) {
	return readManifest(await repositoryRoot(directory ?? services.cwd, services), name, services);
}

export async function fingerprint(source: Source, services: Services) {
	const hash = new Bun.CryptoHasher("sha256");
	if (source.kind === "file") {
		return hash.update(await services.readBytes(source.source)).digest("hex");
	}
	const { directory } = source;
	const files = await definitionFiles(directory, services);
	for (const file of files.toSorted()) {
		// eslint-disable-next-line no-await-in-loop -- Feed bytes in sorted order into the single hash.
		const content = await services.readBytes(file);
		hash.update(JSON.stringify([relative(directory, file), content.byteLength]));
		hash.update(content);
	}
	return hash.digest("hex");
}

async function repositoryRoot(directory: string, services: Services): Promise<string> {
	const output = await services.execute(
		["git", "rev-parse", "--show-toplevel"],
		resolve(services.cwd, directory),
	);
	return output.trim();
}

async function readManifest(repo: string, name: string, services: Services) {
	const directory = join(repo, ".workflows", nameSchema.parse(name));
	await services.readDirectory(directory).catch((error) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new BusyBeeError("workflow_missing", `Named workflow ${name} is missing from ${repo}`, {
				cause: error,
				context: { name, repo },
			});
		}
		throw error;
	});
	const content = await services.readText(join(directory, "busybee.toml"));
	const metadata = manifestSchema.parse(Bun.TOML.parse(content));
	const source = resolve(directory, metadata.run);
	if (isAbsolute(metadata.run) || relative(directory, source).split(sep)[FIRST] === "..") {
		throw new BusyBeeError(
			"invalid_manifest",
			`Workflow ${name} run must be relative and stay inside its definition folder`,
		);
	}
	if (!(await services.isFile(source))) {
		throw new BusyBeeError("invalid_entry", `Workflow ${name} entry is not a file: ${source}`);
	}
	return { directory, kind: "folder" as const, metadata: { name, ...metadata }, name, source };
}

async function definitionFiles(directory: string, services: Services): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await services.readDirectory(directory)) {
		const path = join(directory, entry.name);
		if (entry.kind === "directory") {
			// eslint-disable-next-line no-await-in-loop -- Walk one authoring tree deterministically.
			const nested = await definitionFiles(path, services);
			files.push(...nested);
		} else if (entry.kind === "file") {
			files.push(path);
		} else {
			throw new BusyBeeError(
				"invalid_entry",
				`Definition files must be regular files or directories: ${path}`,
			);
		}
	}
	return files;
}
