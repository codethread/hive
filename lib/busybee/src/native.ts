import type { BeadRecord, BeadsScope, BeadsService, UpdateBead } from "@hive/beads";
import { CommandError, createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Filesystem access is injected at this native adapter.
import { readdir, stat } from "node:fs/promises";
import { execute as executeProcess } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Author modules are trusted and loaded at the I/O seam.
import { pathToFileURL } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Lock identities are generated at the native boundary.
import { randomUUID } from "node:crypto";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve caller-selected execution paths.
import { resolve } from "node:path";

const CONFLICT = 6;
export interface Options {
	/** Audit identity, otherwise BD_ACTOR. */
	actor?: string;
	/** Initial run/manual worker assignment. */
	assignee?: string;
	/** Explicit native database override. */
	db?: string;
	/** Initial JSON input path. */
	inputFile?: string;
	/** Accountable human, required at start. */
	owner?: string;
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
		cwd: process.cwd(),
		execute: (argv, cwd) => executeProcess(argv, cwd, process.env),
		importModule: (source) => import(pathToFileURL(source).href) as Promise<unknown>,
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
