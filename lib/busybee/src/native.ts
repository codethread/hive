import { CommandError, beadSchema, execute as executeProcess } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Filesystem access is injected at this native adapter.
import { readdir, stat } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Author modules are trusted and loaded at the I/O seam.
import { pathToFileURL } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Lock identities are generated at the native boundary.
import { randomUUID } from "node:crypto";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve caller-selected execution paths.
import { resolve } from "node:path";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const CONFLICT = 6;
const endpointSchema = z.object({ database_path: z.string().min(ONE) });
const createdSchema = z.object({ id: z.string().min(ONE) });
export const nativeBeadSchema = beadSchema.extend({
	created_by: z.string(),
	notes: z.string().default(""),
});
export type NativeBead = z.infer<typeof nativeBeadSchema>;
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
	const args = ["br", "where", "--json"];
	if (options.db) {
		args.push("--db", options.db);
	}
	const selection = endpointSchema.parse(JSON.parse(await services.execute(args, repo)) as unknown);
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

export async function tracker(
	endpoint: Endpoint,
	args: string[],
	services: Services,
): Promise<unknown> {
	return JSON.parse(
		await services.execute(["br", ...args, "--db", endpoint.db, "--json"], endpoint.repo),
	) as unknown;
}

export async function readBead(
	endpoint: Endpoint,
	id: string,
	services: Services,
): Promise<NativeBead> {
	const records = z
		.array(nativeBeadSchema)
		.length(ONE)
		.parse(await tracker(endpoint, ["show", id], services));
	return records[FIRST]!;
}

export async function createTask(
	endpoint: MutationEndpoint,
	task: CreateTask,
	services: Services,
): Promise<string> {
	const args = [
		"create",
		"--title",
		task.title,
		"--description",
		task.description,
		"--type",
		"task",
		"--owner",
		task.owner,
		"--status",
		task.status,
		"--actor",
		endpoint.actor,
	];
	if (task.parent) {
		args.push("--parent", task.parent);
	}
	if (task.assignee) {
		args.push("--assignee", task.assignee);
	}
	for (const label of task.labels) {
		args.push("--labels", label);
	}
	services.beforeWrite();
	return createdSchema.parse(await tracker(endpoint, args, services)).id;
}

export async function closeTask(
	endpoint: MutationEndpoint,
	id: string,
	services: Services,
): Promise<void> {
	const task = await readBead(endpoint, id, services);
	if (task.status !== "closed") {
		services.beforeWrite();
		await tracker(
			endpoint,
			["close", id, "--reason", "Completed: XState step finished.", "--actor", endpoint.actor],
			services,
		);
	}
}

export async function conditionalUpdate(
	request: { endpoint: MutationEndpoint; bead: NativeBead; args: string[] },
	services: Services,
): Promise<boolean> {
	const { endpoint, bead, args } = request;
	try {
		services.beforeWrite();
		await tracker(
			endpoint,
			[
				"update",
				bead.id,
				...args,
				"--if-unchanged",
				bead.updated_at,
				"--force",
				"--actor",
				endpoint.actor,
			],
			services,
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
