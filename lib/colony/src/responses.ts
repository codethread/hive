/* eslint-disable unicorn/no-null -- Public history distinguishes unknown authorship and exhausted pages. */
import type { PublishResponseInput, ResponseContext, ResponseScope } from "./response-store.ts";
import {
	ResponseError,
	getResponse,
	publishResponse,
	resolveResponse,
	responseDocumentSchema,
	searchResponses,
} from "./response-store.ts";
import { readSpawnRequestSummary, requestOutcome } from "@hive/shared";
import type { InspectionOptions } from "./bee-cli.ts";
import type { TrackerCommands } from "./tracker.ts";
import { trackerScope } from "./tracker.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const JSON_INDENT = 2;
const actorSchema = z.string().trim().min(ONE);
const searchSourceSchema = z.enum(["responses", "comments", "notes"]);
const historySourceSchema = z.enum(["comments", "notes"]);
const repositorySchema = z.object({ root: z.string(), beadsDb: z.string() });
const recordSchema = responseDocumentSchema.extend({
	id: z.string(),
	title: z.string(),
	createdAt: z.string(),
});
const pageSchema = z.object({
	limit: z.number(),
	offset: z.number(),
	hasMore: z.boolean(),
	nextOffset: z.number().nullable(),
});
const publishedSchema = z.object({
	kind: z.literal("response_published"),
	repository: repositorySchema,
	responseId: z.string(),
	taskId: z.string(),
	requestId: z.string().optional(),
	effect: z.enum(["created", "existing"]),
});
const foundSchema = z.object({
	kind: z.literal("response_get"),
	repository: repositorySchema,
	response: recordSchema,
});
const resultSchema = z.object({
	kind: z.literal("request_result"),
	repository: repositorySchema,
	response: recordSchema,
	request: z.object({
		id: z.string(),
		identity: z.string(),
		taskId: z.string(),
		role: z.enum(["driver", "stage"]),
		status: z.string(),
		closedAt: z.string().nullable(),
		closeReason: z.string().nullable(),
		outcome: z.enum(["pending", "succeeded", "failed", "cancelled"]),
	}),
});
const responseSummarySchema = z.object({
	source: z.literal("response"),
	responseId: z.string(),
	title: z.string(),
	createdAt: z.string(),
});
const candidateSchema = z.object({
	source: z.enum(["comment-candidate", "notes-candidate"]),
	taskId: z.string(),
	title: z.string(),
});
const searchItemsSchema = z.union([responseSummarySchema, candidateSchema]);
const searchSchema = pageSchema.extend({
	kind: z.literal("response_search"),
	repository: repositorySchema,
	source: z.enum(["responses", "comments", "notes"]),
	hiddenClosedCount: z.number(),
	items: z.array(searchItemsSchema),
});
const coverageSchema = z.object({
	totalReturnedByNative: z.number(),
	offset: z.number(),
	returned: z.number(),
	hasMore: z.boolean(),
});
const commentSchema = z.object({
	source: z.literal("comment"),
	taskId: z.string(),
	author: z.string(),
	createdAt: z.string(),
	text: z.string(),
	localCommentId: z.number(),
});
const commentsSchema = pageSchema.extend({
	kind: z.literal("response_history"),
	repository: repositorySchema,
	source: z.literal("comments"),
	taskId: z.string(),
	nativeRead: z.literal("all-task-comments"),
	coverage: coverageSchema,
	items: z.array(commentSchema),
});
const notesSchema = z.object({
	kind: z.literal("response_history"),
	repository: repositorySchema,
	source: z.literal("notes"),
	taskId: z.string(),
	text: z.string(),
	snapshotUpdatedAt: z.string(),
	author: z.null(),
	authoredAt: z.null(),
});
const outputSchema = z.union([
	publishedSchema,
	foundSchema,
	resultSchema,
	searchSchema,
	commentsSchema,
	notesSchema,
]);
const selectionSchema = z.object({
	limit: z.coerce.number().int().min(ONE).max(MAX_LIMIT).default(DEFAULT_LIMIT),
	offset: z.coerce.number().int().nonnegative().default(ZERO),
});

export type ResponseCommandResult = z.infer<typeof outputSchema>;
export interface PublishOptions extends InspectionOptions {
	/** Native mutation attribution, never supplied by the body file. */
	actor: string;
	/** File containing complete authored Markdown. */
	bodyFile: string;
	/** Explicit managed request overrides injected request context. */
	request?: string;
	/** Publish a task-scoped artifact independent of the executing request. */
	standalone: boolean;
	/** Optional short artifact summary. */
	title?: string;
	/** Explicit immutable correction targets. */
	supersedes?: string[];
}
export interface ResponseGetOptions extends InspectionOptions {
	/** Task resolution instead of an exact artifact identity. */
	task?: string;
	/** Select only this captured request lineage. */
	request?: string;
}
export interface ResponsePageOptions extends InspectionOptions {
	/** Source-specific native offset, never a combined history cursor. */
	offset?: string;
	/** Returned page size, 1–100. */
	limit?: string;
	/** Responses, comment-search candidates, or notes-search candidates. */
	source?: string;
}
export interface ResponseCommands extends TrackerCommands {
	/** File I/O supplied by the application entry point. */
	readBody: (file: string) => Promise<string>;
	/** Captured HIVE_SPAWN_ID, absent outside managed execution. */
	managedRequestId: string | undefined;
}

/** Machine-readable success and failure contracts, independent of tracker access. */
export function responseJsonSchema() {
	const success = outputSchema.options.map((schema) => schema.extend({ ok: z.literal(true) }));
	const effectSchema = z.object({ operation: z.literal("create"), responseId: z.string() });
	const failure = z.object({
		ok: z.literal(false),
		kind: z.literal("error"),
		reason: z.union([z.string(), z.number()]),
		message: z.string(),
		taskId: z.string().optional(),
		requestId: z.string().optional(),
		responseIds: z.array(z.string()).optional(),
		confirmedEffects: z.array(effectSchema).optional(),
		uncertainOperation: z.enum(["create", "readback"]).optional(),
	});
	return z.toJSONSchema(z.union([...success, failure]));
}

// eslint-disable-next-line max-statements -- Resolve publication context before the file read and single storage call.
export async function publishTaskResponse(
	taskId: string,
	options: PublishOptions,
	deps: ResponseCommands,
): Promise<ResponseCommandResult> {
	if (options.standalone && options.request !== undefined) {
		throw invalidInput("--standalone and --request are mutually exclusive");
	}
	const actor = parseInput(actorSchema, options.actor);
	const { repository, context } = await responseContext(options, deps, actor);
	let requestId = options.request ?? deps.managedRequestId;
	if (options.standalone) {
		requestId = undefined;
	}
	const input: PublishResponseInput = {
		taskId,
		requestId,
		body: await deps.readBody(options.bodyFile),
		supersedes: options.supersedes ?? [],
	};
	if (options.title !== undefined) {
		input.title = options.title;
	}
	const receipt = await publishResponse(context, input);
	return { kind: "response_published", repository, ...receipt };
}

export async function readTaskResponse(
	id: string | undefined,
	options: ResponseGetOptions,
	deps: TrackerCommands,
): Promise<ResponseCommandResult> {
	if (
		(id === undefined) === (options.task === undefined) ||
		(id !== undefined && options.request !== undefined)
	) {
		throw invalidInput("Choose an exact response ID or --task TASK [--request REQUEST]");
	}
	const { context, repository } = await responseContext(options, deps);
	if (id === undefined) {
		const response = await resolvedRecord(context, {
			taskId: options.task!,
			requestId: options.request,
		});
		return { kind: "response_get", repository, response };
	}
	return { kind: "response_get", repository, response: await getResponse(context, id) };
}

/** Focused exact request lookup: no ready set, task detail, comments or recipe output. */
// eslint-disable-next-line max-statements -- Resolve the captured role and its exact native anchor in order.
export async function readRequestResult(
	id: string,
	options: InspectionOptions,
	deps: TrackerCommands,
): Promise<ResponseCommandResult> {
	const { context, repository } = await responseContext(options, deps);
	const { issues } = await context.beads.list(context.scope, { ids: [id], all: true });
	const row = issues.at(ZERO);
	if (!row) {
		throw new ResponseError("invalid_response_request", `Unknown request ${id}`, { requestId: id });
	}
	const request = capturedRequest(row);
	let taskId = request.assignment.runId;
	if (request.assignment.kind === "stage") {
		taskId = request.assignment.stageId;
	}
	const edges = await context.beads.dep.list(context.scope, id, {
		direction: "down",
		type: "related",
	});
	if (edges.length !== ONE || edges[ZERO]!.depends_on_id !== taskId) {
		throw new ResponseError(
			"invalid_response_request",
			"Request does not link its captured anchor",
			{ requestId: id, taskId },
		);
	}
	const response = await resolvedRecord(context, { taskId, requestId: id });
	return {
		kind: "request_result",
		repository,
		response,
		request: {
			id,
			taskId,
			identity: request.identity,
			role: request.assignment.kind,
			status: row.status,
			closedAt: row.closed_at ?? null,
			closeReason: row.close_reason ?? null,
			// Outcome uses native closure only; no history or relationships are consumed by this helper.
			outcome: requestOutcome({ ...row, comments: [], dependencies: [], dependents: [] }),
		},
	};
}

// eslint-disable-next-line max-statements -- Keep each native source and its continuation metadata visible together.
export async function findResponses(
	query: string,
	options: ResponsePageOptions,
	deps: TrackerCommands,
): Promise<ResponseCommandResult> {
	const source = parseInput(searchSourceSchema, options.source ?? "responses");
	const page = parseInput(selectionSchema, options);
	const { context, repository } = await responseContext(options, deps);
	if (source === "responses") {
		return {
			kind: "response_search",
			repository,
			source,
			...(await searchResponses(context, { query, ...page })),
		};
	}
	const selection = { all: true, excludeLabels: ["system"], ...page };
	const fields = ["id", "title"] as const;
	if (source === "comments") {
		const found = await context.beads.searchProjected(context.scope, query, selection, fields);
		return {
			kind: "response_search",
			repository,
			source,
			...page,
			items: found.issues.map(({ id, title }) => ({
				source: "comment-candidate",
				taskId: id,
				title,
			})),
			hasMore: found.has_more,
			nextOffset: nextOffset(page, found.has_more),
			hiddenClosedCount: found.hidden_closed_count,
		};
	}
	const found = await context.beads.listProjected(
		context.scope,
		{ ...selection, notesContains: query },
		fields,
	);
	return {
		kind: "response_search",
		repository,
		source,
		...page,
		items: found.issues.map(({ id, title }) => ({ source: "notes-candidate", taskId: id, title })),
		hasMore: found.has_more,
		nextOffset: nextOffset(page, found.has_more),
		hiddenClosedCount: ZERO,
	};
}

// eslint-disable-next-line max-statements -- Preserve each historical source and its native read coverage.
export async function readResponseHistory(
	taskId: string,
	options: ResponsePageOptions,
	deps: TrackerCommands,
): Promise<ResponseCommandResult> {
	const source = parseInput(historySourceSchema, options.source ?? "comments");
	const page = parseInput(selectionSchema, options);
	const { context, repository } = await responseContext(options, deps);
	if (source === "notes") {
		if (page.offset !== ZERO) {
			throw invalidInput("Notes is one snapshot; --offset must be 0");
		}
		const found = await context.beads.listProjected(
			context.scope,
			{ ids: [taskId], all: true, excludeLabels: ["system"] },
			["notes", "updated_at"],
		);
		const row = found.issues.at(ZERO);
		if (!row) {
			throw new ResponseError("invalid_response_target", `Unknown ordinary task ${taskId}`, {
				taskId,
			});
		}
		return {
			kind: "response_history",
			repository,
			source,
			taskId,
			text: row.notes,
			snapshotUpdatedAt: row.updated_at,
			author: null,
			authoredAt: null,
		};
	}
	const found = await context.beads.listProjected(
		context.scope,
		{ ids: [taskId], all: true, excludeLabels: ["system"] },
		["id"],
	);
	if (found.issues.length === ZERO) {
		throw new ResponseError("invalid_response_target", `Unknown ordinary task ${taskId}`, {
			taskId,
		});
	}
	const comments = await context.beads.comments.list(context.scope, taskId);
	const selected = comments.slice(page.offset, page.offset + page.limit);
	const hasMore = page.offset + selected.length < comments.length;
	return {
		kind: "response_history",
		repository,
		source,
		taskId,
		...page,
		hasMore,
		nextOffset: nextOffset(page, hasMore),
		nativeRead: "all-task-comments",
		coverage: {
			totalReturnedByNative: comments.length,
			offset: page.offset,
			returned: selected.length,
			hasMore,
		},
		items: selected.map(({ id, author, created_at, text }) => ({
			source: "comment",
			taskId,
			author,
			createdAt: created_at,
			text,
			localCommentId: id,
		})),
	};
}

/** Human detail prints the original body; summaries keep only native identities. */
export function formatResponseResult(result: ResponseCommandResult): string {
	if (result.kind === "response_published") {
		return (
			`Response ${result.responseId}: ${result.effect}; task ${result.taskId}; ` +
			`request ${result.requestId ?? "standalone"}\n`
		);
	}
	if (result.kind === "response_get" || result.kind === "request_result") {
		const record = result.response;
		let prefix = "";
		if (result.kind === "request_result") {
			prefix = `Request ${result.request.id}: ${result.request.outcome} (${result.request.status})\n`;
		}
		return (
			`${prefix}Response ${record.id}; task ${record.taskId}; request ${record.requestId ?? "standalone"}; ` +
			`author ${record.author}; created ${record.createdAt}; ` +
			`supersedes ${record.supersedes.join(", ") || "none"}\n\n${record.body}\n`
		);
	}
	return `${JSON.stringify(result, undefined, JSON_INDENT)}\n`;
}

// --- Private functions ---
async function responseContext(options: InspectionOptions, deps: TrackerCommands, actor?: string) {
	const repository = await deps.resolveRepository(options.repo, options.beadsDb);
	return { repository, context: { beads: deps.beads, scope: trackerScope(repository, actor) } };
}
async function resolvedRecord(context: ResponseContext, selection: ResponseScope) {
	const resolution = await resolveResponse(context, selection);
	if (resolution.state !== "available") {
		throw new ResponseError(
			`response_${resolution.state}`,
			`Response ${resolution.state} for ${selection.taskId}`,
			{ ...selection, responseIds: resolution.responseIds },
		);
	}
	return getResponse(context, resolution.responseIds[ZERO]);
}
function invalidInput(message: string) {
	return new ResponseError("invalid_response_input", message);
}
function nextOffset(page: { offset: number; limit: number }, hasMore: boolean) {
	if (hasMore) {
		return page.offset + page.limit;
	}
	return null;
}

function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
	const parsed = schema.safeParse(value, { jitless: true });
	if (!parsed.success) {
		throw invalidInput(parsed.error.message);
	}
	return parsed.data;
}

function capturedRequest(row: Parameters<typeof readSpawnRequestSummary>[typeof ZERO]) {
	try {
		return readSpawnRequestSummary(row);
	} catch (error) {
		throw new ResponseError(
			"invalid_response_request",
			`Invalid captured request ${row.id}: ${String(error)}`,
			{ requestId: row.id },
			{ cause: error },
		);
	}
}
