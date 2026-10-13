// Native dep and query operations keep scope, identifiers and their named options explicit.
/* eslint-disable max-params */
import type {
	BeadSelection,
	BeadsScope,
	BeadsService,
	CreateBead,
	ReadySelection,
	UpdateBead,
} from "./service.ts";
import { CommandError, beadCommentSchema, beadSchema } from "./model.ts";
import { z } from "zod";

const FIRST = 0;
const ONE = 1;
const SUCCESS = 0;
const relationSchema = z.object({
	id: z.string(),
	dependency_type: z.string(),
	title: z.string(),
	status: z.string(),
	priority: z.number(),
	issue_type: z.string().optional(),
});
const recordSchema = beadSchema.extend({
	dependencies: z.array(relationSchema).default([]),
	dependents: z.array(relationSchema).default([]),
	title: z.string(),
	issue_type: z.string(),
	created_by: z.string().optional(),
	notes: z.string().default(""),
	design: z.string().default(""),
	acceptance_criteria: z.string().default(""),
	defer_until: z.string().optional(),
	due_at: z.string().optional(),
});
const createdSchema = recordSchema.omit({ dependencies: true, dependents: true, comments: true });
const readySchema = createdSchema.pick({
	id: true,
	title: true,
	issue_type: true,
	status: true,
	priority: true,
	created_at: true,
	updated_at: true,
	labels: true,
});
const selectedSchema = createdSchema.extend({
	dependency_count: z.number().int().nonnegative(),
	dependent_count: z.number().int().nonnegative(),
});
const pageSchema = z.object({
	issues: z.array(selectedSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
	has_more: z.boolean(),
});
const searchSchema = pageSchema.omit({ total: true }).extend({ hidden_closed_count: z.number() });
const updateSchema = z.array(
	z.object({
		id: z.string(),
		title: z.string(),
		status: z.string(),
		priority: z.number(),
		assignee: z.string().nullable(),
		owner: z.string().nullable(),
		updated_at: z.string(),
	}),
);
const closeSchema = z.array(
	z.object({
		id: z.string(),
		title: z.string(),
		status: z.string(),
		closed_at: z.string(),
		close_reason: z.string(),
	}),
);
const dependencySchema = z.object({
	status: z.string(),
	issue_id: z.string(),
	depends_on_id: z.string(),
	type: z.string(),
	action: z.enum(["added", "already_exists", "removed", "not_found"]),
});
const dependencyEdgeSchema = z.object({
	issue_id: z.string(),
	depends_on_id: z.string(),
	type: z.string(),
	title: z.string(),
	status: z.string(),
	priority: z.number(),
});
const queryReceiptSchema = z.object({
	status: z.string(),
	name: z.string(),
	action: z.enum(["saved", "deleted"]),
});
const savedQuerySchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	created_at: z.string(),
});
const queryListSchema = z.object({ queries: z.array(savedQuerySchema), count: z.number() });
const locationSchema = z.object({ database_path: z.string(), beads_dir: z.string().optional() });
const syncStatusSchema = z.object({
	coverage_drift: z.boolean(),
	jsonl_exists: z.boolean(),
	jsonl_newer: z.boolean(),
	workspace_health: z.string(),
});

export interface NativeBeadsOptions {
	/** Invocation environment; explicit operation scope overrides these values. */
	env?: NodeJS.ProcessEnv;
	/** Native process boundary, injectable for transport tests. */
	execute?: (argv: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<string>;
}

export function createNativeBeads(options: NativeBeadsOptions = {}): BeadsService {
	const execute = options.execute ?? executeProcess;
	const invoke = (scope: BeadsScope, args: string[]) => {
		const argv = [
			"br",
			...booleanFlag("--no-auto-import", scope.noAutoImport),
			...booleanFlag("--no-auto-flush", scope.noAutoFlush),
			...args,
			"--json",
		];
		const env = { ...(options.env ?? process.env) };
		if (scope.db !== undefined) {
			argv.push("--db", scope.db);
			env.BEADS_DB = scope.db;
		}
		if (scope.actor !== undefined) {
			argv.push("--actor", scope.actor);
			env.BD_ACTOR = scope.actor;
		}
		return execute(argv, scope.cwd, env);
	};
	const read = async <Result>(
		scope: BeadsScope,
		args: string[],
		schema: z.ZodType<Result>,
	): Promise<Result> => schema.parse(JSON.parse(await invoke(scope, args)));
	const synchronize = async (scope: BeadsScope, mode: string): Promise<void> => {
		await invoke(scope, ["sync", mode]);
	};
	return {
		create: (scope, input) => read(scope, ["create", ...createArguments(input)], createdSchema),
		show: async (scope, id) => {
			const records = await read(scope, ["show", id], z.array(recordSchema).length(ONE));
			return records[FIRST]!;
		},
		showMany: (scope, ids) => {
			if (ids.length === FIRST) {
				return Promise.resolve([]);
			}
			return read(scope, ["show", ...ids], z.array(recordSchema));
		},
		list: (scope, selection = {}) => read(scope, formatBeadsQuery(selection), pageSchema),
		search: (scope, text, selection = {}) =>
			read(scope, formatBeadsQuery(selection, text), searchSchema),
		ready: (scope, selection = {}) =>
			read(scope, ["ready", "--brief", ...readyArguments(selection)], z.array(readySchema)),
		update: (scope, ids, input) =>
			read(scope, ["update", ...ids, ...updateArguments(input)], updateSchema),
		close: (scope, id, input = {}) =>
			read(
				scope,
				[
					"close",
					id,
					...optionalValue("--reason", input.reason),
					...booleanFlag("--force", input.force),
				],
				closeSchema,
			),
		where: (scope) => read(scope, ["where"], locationSchema),
		comments: {
			add: (scope, id, text) =>
				read(
					scope,
					["comments", "add", id, ...optionalValue("--message", text)],
					beadCommentSchema,
				),
			list: (scope, id) => read(scope, ["comments", "list", id], z.array(beadCommentSchema)),
		},
		dep: {
			list: (scope, id, selection) =>
				read(
					scope,
					[
						"dep",
						"list",
						id,
						"--direction",
						selection.direction,
						...optionalValue("--type", selection.type),
					],
					z.array(dependencyEdgeSchema),
				),
			add: (scope, id, dependsOn, type) =>
				read(
					scope,
					["dep", "add", id, dependsOn, ...optionalValue("--type", type)],
					dependencySchema,
				),
			remove: (scope, id, dependsOn, type) =>
				read(
					scope,
					["dep", "remove", id, dependsOn, ...optionalValue("--type", type)],
					dependencySchema,
				),
		},
		query: {
			save: (scope, name, selection, description) =>
				read(
					scope,
					[
						"query",
						"save",
						name,
						...selectionArguments(selection),
						...optionalValue("--description", description),
					],
					queryReceiptSchema,
				),
			list: (scope) => read(scope, ["query", "list"], queryListSchema),
			run: (scope, name, overrides = {}) =>
				read(scope, ["query", "run", name, ...selectionArguments(overrides)], pageSchema),
			delete: (scope, name) => read(scope, ["query", "delete", name], queryReceiptSchema),
		},
		sync: {
			import: (scope) => synchronize(scope, "--import-only"),
			flush: (scope) => synchronize(scope, "--flush-only"),
			merge: (scope) => synchronize(scope, "--merge"),
			status: (scope) =>
				read(
					{ ...scope, noAutoImport: true, noAutoFlush: true },
					["sync", "--status"],
					syncStatusSchema,
				),
		},
	};
}

/** Format the equivalent native read for diagnostics; this does not execute commands. */
export function formatBeadsQuery(selection: BeadSelection, text?: string): string[] {
	let command = ["list"];
	if (text !== undefined) {
		command = ["search", text];
	}
	return [...command, ...selectionArguments(selection)];
}

// --- Private functions ---
function createArguments(input: CreateBead): string[] {
	return [
		...fieldArguments(input),
		...joinedValue("--labels", input.labels),
		...joinedValue(
			"--deps",
			input.deps?.map(({ id, type }) => `${type}:${id}`),
		),
	];
}
function fieldArguments(input: Partial<CreateBead>): string[] {
	return [
		...optionalValue("--title", input.title),
		...optionalValue("--description", input.description),
		...optionalValue("--type", input.type),
		...optionalValue("--priority", input.priority),
		...optionalValue("--status", input.status),
		...optionalValue("--owner", input.owner),
		...optionalValue("--assignee", input.assignee),
		...optionalValue("--parent", input.parent),
		...optionalValue("--acceptance-criteria", input.acceptanceCriteria),
		...optionalValue("--defer", input.defer),
		...optionalValue("--due", input.due),
	];
}
function updateArguments(input: UpdateBead): string[] {
	return [
		...fieldArguments(input),
		...optionalValue("--notes", input.notes),
		...optionalValue("--design", input.design),
		...optionalValue("--if-unchanged", input.ifUnchanged),
		...optionalValue("--append-notes", input.appendNotes),
		...booleanFlag("--claim", input.claim),
		...booleanFlag("--force", input.force),
		...joinedValue("--labels", input.labels),
		...joinedValue("--set-labels", input.setLabels),
		...repeatedValues("--add-label", input.addLabels),
		...repeatedValues("--remove-label", input.removeLabels),
	];
}
function selectionArguments(input: BeadSelection): string[] {
	return [
		...repeatedValues("--status", input.status),
		...repeatedValues("--type", input.type),
		...repeatedValues("--priority", input.priority),
		...optionalValue("--assignee", input.assignee),
		...repeatedValues("--id", input.ids),
		...repeatedValues("--label", input.labels),
		...repeatedValues("--label-any", input.labelAny),
		...repeatedValues("--exclude-label", input.excludeLabels),
		...booleanFlag("--unassigned", input.unassigned),
		...booleanFlag("--all", input.all),
		...booleanFlag("--deferred", input.deferred),
		...booleanFlag("--reverse", input.reverse),
		...optionalValue("--title-contains", input.titleContains),
		...optionalValue("--desc-contains", input.descriptionContains),
		...optionalValue("--notes-contains", input.notesContains),
		...optionalValue("--limit", input.limit),
		...optionalValue("--offset", input.offset),
		...optionalValue("--sort", input.sort),
	];
}
function readyArguments(input: ReadySelection): string[] {
	return [
		...optionalValue("--assignee", input.assignee),
		...booleanFlag("--unassigned", input.unassigned),
		...repeatedValues("--label", input.labels),
		...repeatedValues("--label-any", input.labelAny),
		...optionalValue("--priority", input.priority),
		...optionalValue("--type", input.type),
		...optionalValue("--parent", input.parent),
		...booleanFlag("--include-deferred", input.includeDeferred),
		...optionalValue("--limit", input.limit),
		...optionalValue("--sort", input.sort),
	];
}
function optionalValue(flag: string, value: string | number | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	if (String(value).startsWith("-")) {
		return [`${flag}=${value}`];
	}
	return [flag, String(value)];
}
function booleanFlag(flag: string, enabled: boolean | undefined): string[] {
	if (enabled) {
		return [flag];
	}
	return [];
}
function repeatedValues(flag: string, values: readonly (string | number)[] | undefined): string[] {
	return values?.flatMap((value) => optionalValue(flag, value)) ?? [];
}
function joinedValue(flag: string, values: readonly string[] | undefined): string[] {
	if (values === undefined) {
		return [];
	}
	return optionalValue(flag, values.join(","));
}
async function executeProcess(
	argv: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<string> {
	const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== SUCCESS) {
		throw new CommandError(`${argv[FIRST]} ${argv[ONE]}`, { code, stderr, stdout });
	}
	return stdout;
}
