import type { BeadRecord, BeadsScope, BeadsService, UpdateBead } from "@hive/beads";
import { CommandError, createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Filesystem access is injected at this native adapter.
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import defaultManifest from "../../../.workflows/do-work/busybee.toml" with { type: "text" };
// @ts-expect-error -- Bun's text loader imports TypeScript source as a string; tsc sees the chart's exports.
// Bun text imports have a string default export.
// eslint-disable-next-line import/default
import defaultSource from "../../../.workflows/do-work/workflow.ts" with { type: "text" };
import { dependencies } from "../package.json";
import { execute as executeProcess } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Author modules are trusted and loaded at the I/O seam.
import { pathToFileURL } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Lock identities are generated at the native boundary.
import { randomUUID } from "node:crypto";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve caller-selected execution paths.
import { resolve } from "node:path";

const CONFLICT = 6;
const INDENT = 2;
const EMPTY = 0;
const workflowDependencies = { xstate: dependencies.xstate, zod: dependencies.zod };
const defaultPackageManifest = `${JSON.stringify(
	{ private: true, type: "module", dependencies: workflowDependencies },
	undefined,
	INDENT,
)}\n`;
export interface Options {
	/** Audit identity, otherwise BD_ACTOR. */
	actor?: string;
	/** Initial run/driver-handled worker assignment. */
	assignee?: string;
	/** Explicit native database override. */
	db?: string;
	/** Initial JSON input path. */
	inputFile?: string;
	/** Accountable human, required at start. */
	owner?: string;
	/** Existing ordinary work containing a new root workflow; required at start. */
	parent?: string;
	/** Execution checkout, separate from tracker storage. */
	repo?: string;
}
export interface Endpoint {
	/** Native database selected by br. */
	db: string;
	/** Caller execution directory. */
	repo: string;
}
export interface MutationEndpoint extends Endpoint {
	/** Required audit identity for writes. */
	actor: string;
}
export interface DirectoryEntry {
	/** Relative basename. */
	name: string;
	/** Supported authoring folder entries. */
	kind: "directory" | "file" | "other";
}
export interface Services {
	/** Selected tracker discovery and operations, native in production. */
	beads: BeadsService;
	/** Called immediately before an attempted native state write, after prerequisite reads. */
	beforeWrite: () => void;
	/** Invoking directory, not installation directory. */
	cwd: string;
	/** Native agent audit default. */
	actor: string | undefined;
	/** Diagnostic process identity. */
	pid: number;
	/** Captured native output; errors retain command exit status. */
	execute: (argv: string[], cwd: string) => Promise<string>;
	/** Trusted author module loading. */
	importModule: (source: string) => Promise<unknown>;
	/** Ordinary package resolution from an authoring directory; missing packages return false. */
	canResolve: (specifier: string, directory: string) => Promise<boolean>;
	/** Native input and manifest reads. */
	readText: (path: string) => Promise<string>;
	/** Definition fingerprint bytes. */
	readBytes: (path: string) => Promise<ArrayBuffer>;
	/** Authoring directory contents. */
	readDirectory: (path: string) => Promise<DirectoryEntry[]>;
	/** Manifest target inspection without evaluation. */
	isFile: (path: string) => Promise<boolean>;
	/** Lock timing. */
	now: () => number;
	/** Bounded contention wait. */
	sleep: (milliseconds: number) => Promise<void>;
	/** Unique invocation owner. */
	uuid: () => string;
	/** Exclusively install a trusted workflow folder in the selected checkout. */
	installWorkflow: (input: {
		directory: string;
		manifest: string;
		source: string;
		packageManifest: string;
	}) => Promise<void>;
}
export interface CreateTask {
	/** Human-readable work name. */
	title: string;
	/** Instructions or checkpoint JSON. */
	description: string;
	/** Accountable human. */
	owner: string;
	/** Native structural parent. */
	parent?: string;
	/** Worker assignment, absent for containers. */
	assignee?: string;
	/** Initial lifecycle status. */
	status: "open" | "in_progress";
	/** Native labels. */
	labels: string[];
}
export function createServices(): Services {
	return {
		actor: process.env["BD_ACTOR"],
		beads: createNativeBeads(),
		beforeWrite: () => {},
		canResolve: canResolvePackage,
		cwd: process.cwd(),
		execute: (argv, cwd) => executeProcess(argv, cwd, process.env),
		importModule: (source) => import(pathToFileURL(source).href) as Promise<unknown>,
		installWorkflow: installWorkflowFiles,
		isFile: async (path) => {
			const info = await stat(path);
			return info.isFile();
		},
		now: Date.now,
		pid: process.pid,
		readBytes: (path) => Bun.file(path).arrayBuffer(),
		readDirectory: readEntries,
		readText: (path) => Bun.file(path).text(),
		sleep: async (milliseconds) => {
			await Bun.sleep(milliseconds);
		},
		uuid: randomUUID,
	};
}

/** Resolve the catalogue checkout using the same Git root for discovery and installation. */
export async function repositoryRoot(directory: string, services: Services): Promise<string> {
	const output = await services.execute(
		["git", "rev-parse", "--show-toplevel"],
		resolve(services.cwd, directory),
	);
	return output.trim();
}

export async function installDefaultWorkflow(options: Options, services: Services) {
	const repo = await repositoryRoot(options.repo ?? services.cwd, services);
	const directory = resolve(repo, ".workflows/do-work");
	await services.installWorkflow({
		directory,
		manifest: defaultManifest,
		packageManifest: defaultPackageManifest,
		source: defaultSource,
	});
	return {
		dependencies: await dependencyReadiness(directory, services),
		name: "do-work",
		repo,
		source: resolve(directory, "workflow.ts"),
		version: "1.0.0",
	};
}

export async function resolveEndpoint(options: Options, services: Services): Promise<Endpoint> {
	const repo = resolve(services.cwd, options.repo ?? services.cwd);
	const scope: BeadsScope = { cwd: repo };
	if (options.db) {
		scope.db = options.db;
	}
	const selection = await services.beads.where(scope);
	return { db: selection.database_path, repo };
}

export async function resolveMutation(
	options: Options,
	services: Services,
): Promise<MutationEndpoint> {
	const actor = options.actor ?? services.actor;
	if (!actor) {
		throw new BusyBeeError(
			"missing_actor",
			"Mutations require --actor or BD_ACTOR identifying the calling agent.",
		);
	}
	return { ...(await resolveEndpoint(options, services)), actor };
}

export function readBead(endpoint: Endpoint, id: string, services: Services): Promise<BeadRecord> {
	return services.beads.show({ cwd: endpoint.repo, db: endpoint.db }, id);
}

export async function createTask(
	endpoint: MutationEndpoint,
	task: CreateTask,
	services: Services,
): Promise<string> {
	services.beforeWrite();
	const created = await services.beads.create(
		{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
		{ ...task, type: "task" },
	);
	return created.id;
}

export async function closeTask(
	endpoint: MutationEndpoint,
	id: string,
	services: Services,
): Promise<void> {
	const task = await readBead(endpoint, id, services);
	if (task.status !== "closed") {
		services.beforeWrite();
		await services.beads.close({ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db }, id, {
			reason: "Completed: XState step finished.",
		});
	}
}

export async function conditionalUpdate(
	request: {
		endpoint: MutationEndpoint;
		bead: Pick<BeadRecord, "id" | "updated_at">;
		input: UpdateBead;
	},
	services: Services,
): Promise<boolean> {
	const { endpoint, bead, input } = request;
	try {
		services.beforeWrite();
		await services.beads.update(
			{ actor: endpoint.actor, cwd: endpoint.repo, db: endpoint.db },
			[bead.id],
			{ ...input, force: true, ifUnchanged: bead.updated_at },
		);
		return true;
	} catch (error) {
		if (error instanceof CommandError && error.code === CONFLICT) {
			return false;
		}
		throw error;
	}
}

export class BusyBeeError extends Error {
	/** Stable machine-readable failure category. */
	readonly reason: string;
	/** Known target/effect context surfaced by the CLI. */
	readonly context: Record<string, unknown>;
	constructor(
		reason: string,
		message: string,
		details: { cause?: unknown; context?: Record<string, unknown> } = {},
	) {
		super(message, { cause: details.cause });
		this.name = "BusyBeeError";
		this.reason = reason;
		this.context = details.context ?? {};
	}
}

// --- Private functions ---

async function installWorkflowFiles(input: {
	directory: string;
	manifest: string;
	source: string;
	packageManifest: string;
}): Promise<void> {
	await mkdir(resolve(input.directory, ".."), { recursive: true });
	await mkdir(input.directory);
	try {
		await writeFile(resolve(input.directory, "busybee.toml"), input.manifest, { flag: "wx" });
		await writeFile(resolve(input.directory, "workflow.ts"), input.source, { flag: "wx" });
		await writeFile(resolve(input.directory, "../package.json"), input.packageManifest, {
			flag: "wx",
		}).catch((error: unknown) => {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
				throw error;
			}
		});
	} catch (error) {
		throw new BusyBeeError(
			"workflow_install_partial",
			"Workflow installation failed after creating " +
				`${input.directory}` +
				"; inspect the retained files before retrying.",
			{ cause: error, context: { directory: input.directory } },
		);
	}
}
async function canResolvePackage(specifier: string, directory: string): Promise<boolean> {
	try {
		await Bun.resolve(specifier, directory);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
			return false;
		}
		throw error;
	}
}

async function dependencyReadiness(directory: string, services: Services) {
	const packages = await Promise.all(
		Object.keys(workflowDependencies).map(async (name) => ({
			name,
			available: await services.canResolve(name, directory),
		})),
	);
	const missing = packages.filter(({ available }) => !available).map(({ name }) => name);
	let status = "ready";
	if (missing.length > EMPTY) {
		status = "install_required";
	}
	return {
		install: [
			"bun",
			"add",
			"--cwd",
			resolve(directory, ".."),
			...Object.entries(workflowDependencies).map(([name, version]) => `${name}@${version}`),
		],
		manifest: resolve(directory, "../package.json"),
		missing,
		required: workflowDependencies,
		status,
	};
}
async function readEntries(path: string): Promise<DirectoryEntry[]> {
	const entries = await readdir(path, { withFileTypes: true });
	return entries.map((entry) => {
		let kind: DirectoryEntry["kind"] = "other";
		if (entry.isDirectory()) {
			kind = "directory";
		} else if (entry.isFile()) {
			kind = "file";
		}
		return { kind, name: entry.name };
	});
}
