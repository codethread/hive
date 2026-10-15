import type { BeadsScope, BeadsService, ProjectedBead } from "@hive/beads";
import { readSpawnRequestSummary } from "@hive/shared";
import { z } from "zod";

export const RESPONSE_LABEL = "response";
const ZERO = 0;
const ONE = 1;
const MAX_SEARCH_LIMIT = 100;
const responseFields = [
	"id",
	"title",
	"status",
	"issue_type",
	"description",
	"created_at",
] as const;
const nonblank = z.string().refine((value) => value.trim().length > ZERO);
export const responseDocumentSchema = z.strictObject({
	formatVersion: z.literal(ONE),
	taskId: nonblank,
	requestId: nonblank.optional(),
	author: nonblank,
	body: nonblank,
	supersedes: z.array(nonblank).refine((ids) => new Set(ids).size === ids.length),
});
const searchInputSchema = z.object({
	query: z.string(),
	limit: z.number().int().min(ONE).max(MAX_SEARCH_LIMIT),
	offset: z.number().int().nonnegative(),
});
export type ResponseDocument = z.infer<typeof responseDocumentSchema>;
export interface ResponseRecord extends ResponseDocument {
	/** Native identity of this immutable artifact. */
	id: string;
	/** Artifact summary, independent of execution outcome. */
	title: string;
	/** Native creation time, never the producing task's revision time. */
	createdAt: string;
}
export interface ResponseContext {
	/** Injected tracker operations, shared by offline and managed producers. */
	beads: BeadsService;
	/** Explicit tracker and mutation actor; no environment discovery inside this module. */
	scope: BeadsScope;
}
export interface ResponseScope {
	taskId: string;
	/** Omitted on resolution includes every request lineage for this task. */
	requestId?: string | undefined;
}
export interface PublishResponseInput extends ResponseScope {
	body: string;
	title?: string;
	supersedes?: readonly string[];
}
export interface PublishedResponse extends ResponseScope {
	responseId: string;
	effect: "created" | "existing";
}
export type ResponseResolution =
	| { state: "missing"; responseIds: [] }
	| { state: "available"; responseIds: [string] }
	| { state: "ambiguous"; responseIds: string[] };
export interface ResponseSummary {
	responseId: string;
	title: string;
	createdAt: string;
	source: "response";
}
export interface ResponseSearchPage {
	items: ResponseSummary[];
	limit: number;
	offset: number;
	hasMore: boolean;
	nextOffset: number | null;
	/** Native search completeness metadata retained independently of the returned page. */
	hiddenClosedCount: number;
}
export type ResponseErrorReason =
	| "invalid_response"
	| "invalid_response_input"
	| "invalid_response_target"
	| "invalid_response_request"
	| "response_reserved"
	| "response_missing"
	| "response_ambiguous"
	| "response_conflict"
	| "response_publish_uncertain";
export interface ResponseErrorDetails extends Partial<ResponseScope> {
	responseIds?: readonly string[];
	confirmedEffects?: readonly { operation: "create"; responseId: string }[];
	uncertainOperation?: "create" | "readback";
}
export class ResponseError extends Error {
	readonly reason: ResponseErrorReason;
	readonly taskId: string | undefined;
	readonly requestId: string | undefined;
	readonly responseIds: readonly string[];
	readonly confirmedEffects: readonly { operation: "create"; responseId: string }[];
	readonly uncertainOperation: "create" | "readback" | undefined;
	// eslint-disable-next-line max-params -- Error reason, message, public effects and native cause stay distinct.
	constructor(
		reason: ResponseErrorReason,
		message: string,
		details: ResponseErrorDetails = {},
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ResponseError";
		this.reason = reason;
		this.taskId = details.taskId;
		this.requestId = details.requestId;
		this.responseIds = details.responseIds ?? [];
		this.confirmedEffects = details.confirmedEffects ?? [];
		this.uncertainOperation = details.uncertainOperation;
	}
}

/** Publish once locally; explicit corrections preserve every earlier artifact. */
// eslint-disable-next-line max-statements -- Keep preflight, repeat detection and the single mutation in order.
export async function publishResponse(
	context: ResponseContext,
	input: PublishResponseInput,
): Promise<PublishedResponse> {
	const document = publicationDocument(context, input);
	await validateProducer(context, document);
	const records = await taskResponses(context, document.taskId);
	const lineage = records.filter((record) => sameScope(record, document));
	const matches = lineage.filter(
		(record) =>
			record.author === document.author &&
			record.body === document.body &&
			sameIds(record.supersedes, document.supersedes),
	);
	if (matches.length > ONE) {
		throw new ResponseError("response_ambiguous", "Multiple artifacts match this publication", {
			...input,
			responseIds: matches.map(({ id }) => id),
		});
	}
	const existing = matches.at(ZERO);
	if (existing) {
		return publicationReceipt(existing, "existing");
	}
	const heads = currentResponses(lineage);
	if (
		!sameIds(
			document.supersedes,
			heads.map(({ id }) => id),
		)
	) {
		throw new ResponseError(
			"response_conflict",
			"A correction must explicitly supersede every current response in the same scope",
			{ ...input, responseIds: heads.map(({ id }) => id) },
		);
	}
	return createResponse(context, input.title ?? `Response to ${document.taskId}`, document);
}

/** An exact read always returns the named historical artifact, even after correction. */
export async function getResponse(
	context: ResponseContext,
	responseId: string,
): Promise<ResponseRecord> {
	const record = await readResponse(context, responseId);
	const priors = await Promise.all(record.supersedes.map((id) => readResponse(context, id)));
	if (priors.some((prior) => !sameScope(prior, record))) {
		throw invalidResponse(responseId, "Correction targets another response scope");
	}
	return record;
}

/** Native links determine candidates; no timestamp or largest-ID winner is inferred. */
export async function resolveResponse(
	context: ResponseContext,
	selection: ResponseScope,
): Promise<ResponseResolution> {
	const records = await taskResponses(context, selection.taskId);
	const selected = records.filter(
		(record) => selection.requestId === undefined || record.requestId === selection.requestId,
	);
	const responseIds = currentResponses(selected)
		.map(({ id }) => id)
		.toSorted();
	if (responseIds.length === ZERO) {
		return { state: "missing", responseIds: [] };
	}
	if (responseIds.length === ONE) {
		return { state: "available", responseIds: [responseIds[ZERO]!] };
	}
	return { state: "ambiguous", responseIds };
}

/** Bounded response-record matches; the body is loaded only through an explicit read. */
export async function searchResponses(
	context: ResponseContext,
	input: { query: string; limit: number; offset: number },
): Promise<ResponseSearchPage> {
	const parsed = searchInputSchema.safeParse(input, { jitless: true });
	if (!parsed.success) {
		throw new ResponseError(
			"invalid_response_input",
			"Invalid response search page",
			{},
			{
				cause: parsed.error,
			},
		);
	}
	const page = await context.beads.searchProjected(
		context.scope,
		input.query,
		{
			all: true,
			labels: [RESPONSE_LABEL],
			excludeLabels: ["system"],
			limit: input.limit,
			offset: input.offset,
		},
		["id", "title", "created_at"],
	);
	// eslint-disable-next-line unicorn/no-null -- Explicit exhaustion in the public paging contract.
	let nextOffset: number | null = null;
	if (page.has_more) {
		nextOffset = page.offset + page.issues.length;
	}
	return {
		items: page.issues.map((row) => ({
			responseId: row.id,
			title: row.title,
			createdAt: row.created_at,
			source: "response",
		})),
		limit: page.limit,
		offset: page.offset,
		hasMore: page.has_more,
		nextOffset,
		hiddenClosedCount: page.hidden_closed_count,
	};
}

// --- Private functions ---
function publicationDocument(
	context: ResponseContext,
	input: PublishResponseInput,
): ResponseDocument {
	const result = responseDocumentSchema.safeParse(
		{
			formatVersion: ONE,
			taskId: input.taskId,
			requestId: input.requestId,
			author: context.scope.actor,
			body: input.body,
			supersedes: input.supersedes ?? [],
		},
		{ jitless: true },
	);
	if (!result.success) {
		throw new ResponseError(
			"invalid_response_input",
			"Invalid response document or missing actor",
			input,
			{
				cause: result.error,
			},
		);
	}
	return result.data;
}

async function validateProducer(
	context: ResponseContext,
	document: ResponseDocument,
): Promise<void> {
	const { beads, scope } = context;
	const targets = await beads.list(scope, { ids: [document.taskId], all: true });
	const target = targets.issues.at(ZERO);
	if (!target || target.labels.includes("system") || target.labels.includes(RESPONSE_LABEL)) {
		throw new ResponseError(
			"invalid_response_target",
			"Response target must be ordinary work",
			document,
		);
	}
	if (
		target.labels.includes("hitl") ||
		target.assignee === "ct" ||
		(target.assignee && target.assignee !== document.author)
	) {
		throw new ResponseError(
			"response_reserved",
			"Response target is reserved by another actor or HITL",
			document,
		);
	}
	if (document.requestId === undefined) {
		return;
	}
	await validateRequest(context, { ...document, requestId: document.requestId });
}

// eslint-disable-next-line max-statements -- Validate the captured identity, role and exact native anchor together.
async function validateRequest(
	{ beads, scope }: ResponseContext,
	document: ResponseDocument & { requestId: string },
): Promise<void> {
	try {
		const requests = await beads.list(scope, { ids: [document.requestId], all: true });
		const requestRow = requests.issues.at(ZERO);
		if (!requestRow) {
			throw new Error("Unknown request");
		}
		const request = readSpawnRequestSummary(requestRow);
		const edges = await beads.dep.list(scope, request.id, { direction: "down", type: "related" });
		let anchor = request.assignment.runId;
		if (request.assignment.kind === "stage") {
			anchor = request.assignment.stageId;
		}
		if (
			request.identity !== document.author ||
			anchor !== document.taskId ||
			edges.length !== ONE ||
			edges[ZERO]!.depends_on_id !== anchor
		) {
			throw new Error("Request identity or completion anchor differs from the producer");
		}
	} catch (error) {
		throw new ResponseError(
			"invalid_response_request",
			`Invalid response request: ${String(error)}`,
			document,
			{ cause: error },
		);
	}
}

async function readResponse(context: ResponseContext, id: string): Promise<ResponseRecord> {
	const page = await context.beads.listProjected(
		context.scope,
		{ ids: [id], all: true, labels: [RESPONSE_LABEL], excludeLabels: ["system"] },
		responseFields,
	);
	const row = page.issues.at(ZERO);
	if (!row) {
		throw new ResponseError("response_missing", `Unknown response ${id}`, { responseIds: [id] });
	}
	return decodeResponse(context, row);
}

async function decodeResponse(
	context: ResponseContext,
	row: ProjectedBead<typeof responseFields>,
): Promise<ResponseRecord> {
	const document = decodeDocument(row);
	const edges = await context.beads.dep.list(context.scope, row.id, { direction: "down" });
	const expected = responseDependencies(document).map(({ id, type }) => `${type}:${id}`);
	if (
		row.status !== "closed" ||
		row.issue_type !== "docs" ||
		!sameIds(
			expected,
			edges.map(({ type, depends_on_id }) => `${type}:${depends_on_id}`),
		)
	) {
		throw invalidResponse(row.id, "Response lifecycle or native links disagree with its document");
	}
	return { ...document, id: row.id, title: row.title, createdAt: row.created_at };
}

async function taskResponses(context: ResponseContext, taskId: string): Promise<ResponseRecord[]> {
	const edges = await context.beads.dep.list(context.scope, taskId, {
		direction: "up",
		type: "replies-to",
	});
	if (edges.length === ZERO) {
		return [];
	}
	const page = await context.beads.listProjected(
		context.scope,
		{
			ids: edges.map(({ issue_id }) => issue_id),
			all: true,
			labels: [RESPONSE_LABEL],
			excludeLabels: ["system"],
			limit: ZERO,
		},
		responseFields,
	);
	const records = await Promise.all(page.issues.map((row) => decodeResponse(context, row)));
	for (const record of records) {
		if (
			record.taskId !== taskId ||
			record.supersedes.some(
				(id) => !records.some((prior) => prior.id === id && sameScope(prior, record)),
			)
		) {
			throw invalidResponse(record.id, "Response links cross task or request lineage");
		}
	}
	return records;
}

function currentResponses(records: ResponseRecord[]): ResponseRecord[] {
	const replaced = new Set(records.flatMap(({ supersedes }) => supersedes));
	const heads = records.filter(({ id }) => !replaced.has(id));
	if (records.length > ZERO && heads.length === ZERO) {
		throw invalidResponse(records[ZERO]!.id, "Response corrections contain a cycle");
	}
	return heads;
}

async function createResponse(
	context: ResponseContext,
	title: string,
	document: ResponseDocument,
): Promise<PublishedResponse> {
	let details: ResponseErrorDetails = { ...document, uncertainOperation: "create" };
	try {
		const created = await context.beads.create(context.scope, {
			title,
			type: "docs",
			status: "closed",
			owner: "ct",
			labels: [RESPONSE_LABEL],
			description: JSON.stringify(document),
			deps: responseDependencies(document),
		});
		const responseId = created.id;
		details = {
			...document,
			responseIds: [responseId],
			confirmedEffects: [{ operation: "create", responseId }],
			uncertainOperation: "readback",
		};
		const record = await getResponse(context, responseId);
		if (
			!sameScope(record, document) ||
			record.author !== document.author ||
			record.body !== document.body ||
			!sameIds(record.supersedes, document.supersedes)
		) {
			throw invalidResponse(responseId, "Created response differs from the publication");
		}
		return publicationReceipt(record, "created");
	} catch (error) {
		throw new ResponseError(
			"response_publish_uncertain",
			`Response publication requires inspection: ${String(error)}`,
			details,
			{ cause: error },
		);
	}
}

function responseDependencies(document: ResponseDocument): { id: string; type: string }[] {
	const deps = [{ id: document.taskId, type: "replies-to" }];
	if (document.requestId !== undefined) {
		deps.push({ id: document.requestId, type: "related" });
	}
	return [...deps, ...document.supersedes.map((id) => ({ id, type: "supersedes" }))];
}
function sameScope(left: ResponseScope, right: ResponseScope): boolean {
	return left.taskId === right.taskId && left.requestId === right.requestId;
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
	const sortedRight = right.toSorted();
	return (
		left.length === right.length && left.toSorted().every((id, index) => id === sortedRight[index])
	);
}
function publicationReceipt(
	record: ResponseRecord,
	effect: PublishedResponse["effect"],
): PublishedResponse {
	return { responseId: record.id, taskId: record.taskId, requestId: record.requestId, effect };
}
function decodeDocument(row: ProjectedBead<typeof responseFields>): ResponseDocument {
	try {
		return responseDocumentSchema.parse(JSON.parse(row.description), { jitless: true });
	} catch (error) {
		throw invalidResponse(row.id, "Malformed response document", error);
	}
}
function invalidResponse(id: string, message: string, cause?: unknown): ResponseError {
	return new ResponseError(
		"invalid_response",
		`${message}: ${id}`,
		{ responseIds: [id] },
		{ cause },
	);
}
