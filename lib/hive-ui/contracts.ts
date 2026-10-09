/* eslint-disable unicorn/max-nested-calls -- Boundary schemas keep complete discriminated variants visible together. */
import { z } from "zod";

export const PAGE_SIZE = 60;
export const REQUEST_PAGE_SIZE = 50;
export const RELATION_LIMIT = 50;
export const boardScopeSchema = z.object({
	/** Zero-based completed request history page; other views use page zero. */
	requestPage: z.number().int().nonnegative().default(0),
	/** Ordinary task board, open Bee requests or completed Bee requests. */
	view: z.enum(["beads", "open", "completed"]).default("open"),
});
export const beadStatusSchema = z.enum(["open", "in_progress", "blocked", "deferred", "closed"]);
const BACKLOG_PRIORITY = 4;

/** A view is a reusable predicate over ordinary task beads, independent of navigation. */
export const beadFilterSchema = z.object({
	/** Every exact label must occur on the same task; native --label arguments. */
	all: z.array(z.string().min(1)).default([]),
	/** At least one exact label must occur on a task; native --label-any arguments. */
	any: z.array(z.string().min(1)).default([]),
	/** Include closed tasks; an explicit Closed status also enables native --all. */
	closed: z.boolean().default(false),
	/** Hide tasks carrying any of these exact labels; native --exclude-label arguments. */
	exclude: z.array(z.string().min(1)).default([]),
	/** Any selected native priorities (0 critical through 4 backlog), intersected with other rules. */
	priorities: z.array(z.number().int().min(0).max(BACKLOG_PRIORITY)).default([]),
	/** Text passed unchanged to native br search; empty selects br list. */
	query: z.string().default(""),
	/** Any selected native statuses, intersected with priority, text and label filters. */
	statuses: z.array(beadStatusSchema).default([]),
});
export const inventoryFilterSchema = boardScopeSchema.extend(beadFilterSchema.shape);
export const boardFilterSchema = inventoryFilterSchema.extend({
	page: z.number().int().nonnegative().default(0),
	/** Selected request narrows linked work; absent for ordinary beads. */
	request: z.string().optional(),
});
export const navigationSchema = boardFilterSchema.extend({
	/** One explicitly expanded ancestry chain, never a whole-history scan. */
	ancestry: z.string().optional(),
	bead: z.string().optional(),
	beeQuery: z.string().default(""),
	presentation: z.enum(["outline", "graph"]).default("outline"),
});
export const colonySchema = z.object({
	beadsDb: z.string(),
	id: z.string(),
	name: z.string(),
	root: z.string(),
});
export const coloniesSchema = z.object({ colonies: z.array(colonySchema) });
export const observationSchema = z.object({ at: z.string(), author: z.string(), text: z.string() });
export const beeSchema = z.object({
	/** Native closure timestamp, absent while the request is open. */
	closedAt: z.string().nullable(),
	harness: z.string(),
	id: z.string(),
	identity: z.string(),
	kind: z.string(),
	model: z.string(),
	observation: observationSchema.nullable(),
	/** Outcome derived from native request status and close reason. */
	outcome: z.enum(["pending", "succeeded", "failed", "cancelled"]),
	requester: z.string().nullable(),
	status: z.string(),
	taskIds: z.array(z.string()),
});
export const cardSchema = z.object({
	assignee: z.string().nullable(),
	id: z.string(),
	labels: z.array(z.string()),
	priority: z.number().int(),
	status: z.string(),
	title: z.string(),
	updatedAt: z.string(),
});
export const requestInventorySchema = z.discriminatedUnion("kind", [
	z.object({
		/** Ordinary-bead reads do not query request membership. */
		kind: z.literal("not_requested"),
	}),
	z.object({
		/** Requests in the selected, bounded inventory page. */
		bees: z.array(beeSchema),
		/** Candidate requests on this history page before task filtering. */
		total: z.number().int().nonnegative(),
		/** Lookahead found another completed request page. */
		hasMore: z.boolean(),
		/** Native request inventory was read for this view. */
		kind: z.literal("loaded"),
		/** Original inventory read time, retained when the cached value is reused. */
		readAt: z.string(),
	}),
]);
export const boardSchema = z.object({
	cards: z.array(cardSchema),
	fetchedAt: z.string(),
	hasMore: z.boolean(),
	labels: z.array(z.string()),
	/** Exact argv preview; the server executes it without a shell. */
	query: z.array(z.string()),
});
export const relationSchema = z.object({
	/** Exact native relation type, retained verbatim for display. */
	dependencyType: z.string(),
	id: z.string(),
	priority: z.number().int(),
	status: z.string(),
	title: z.string(),
});
export const relationsSchema = z.object({
	/** Summaries already present on the selected native show, capped per direction. */
	items: z.array(relationSchema).max(RELATION_LIMIT),
	/** Full number of native edges in this direction, including omitted summaries. */
	total: z.number().int().nonnegative(),
});
export const detailSchema = z.object({
	/** Verbatim native acceptance_criteria; empty when none were recorded. */
	acceptanceCriteria: z.string(),
	card: cardSchema.extend({ bees: z.array(beeSchema) }),
	/** Comments load only with the selected bead, never in board responses. */
	comments: z.array(observationSchema.extend({ id: z.number().int() })),
	/** Native outgoing edges: selected bead is the edge source. */
	dependencies: relationsSchema,
	/** Native incoming edges: selected bead is the edge target. */
	dependents: relationsSchema,
	description: z.string(),
	fetchedAt: z.string(),
});
export const provenanceSchema = z.object({
	/** First entry is the selected request; subsequent entries are name matches. */
	chain: z.array(beeSchema),
	end: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("unmatched"), requester: z.string().nullable() }),
		z.object({
			candidates: z.array(z.string()),
			kind: z.literal("ambiguous"),
			requester: z.string(),
		}),
		z.object({ id: z.string(), kind: z.literal("cycle") }),
		z.object({ kind: z.literal("limit") }),
	]),
	fetchedAt: z.string(),
});
export const apiErrorSchema = z.object({ message: z.string() });

export type BoardScope = z.infer<typeof boardScopeSchema>;
export type BeadFilter = z.infer<typeof beadFilterSchema>;
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export type RequestInventory = z.infer<typeof requestInventorySchema>;
export type Colony = z.infer<typeof colonySchema>;
export type BoardFilter = z.infer<typeof boardFilterSchema>;
export type Navigation = z.infer<typeof navigationSchema>;
export type Bee = z.infer<typeof beeSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;

interface TaskQueryPage {
	/** Maximum matching rows returned by this native query. */
	limit: number;
	/** Matching rows skipped before this page. */
	offset: number;
}

/** Exact native label semantics, including literal commas and case. */
export function taskQuery(filter: BeadFilter, taskIds: string[], page: TaskQueryPage): string[] {
	let args = ["list"];
	if (filter.query) {
		args = ["search", filter.query];
	}
	for (const [values, flag] of [
		[taskIds, "--id"],
		[filter.statuses, "--status"],
		[filter.priorities.map(String), "--priority"],
		[filter.all, "--label"],
		[filter.any, "--label-any"],
		[["system", "bee", ...filter.exclude], "--exclude-label"],
	] as const) {
		args.push(...values.flatMap((value) => [flag, value]));
	}
	if (filter.closed || filter.statuses.includes("closed")) {
		args.push("--all");
	}
	args.push(
		"--deferred",
		"--sort",
		"priority",
		"--limit",
		String(page.limit),
		"--offset",
		String(page.offset),
	);
	return args;
}

export function boardKey(colony: string, filter: BoardFilter): string {
	return JSON.stringify([colony, filter]);
}

export function detailKey(colony: string, id: string, scope: BoardScope): string {
	return JSON.stringify([colony, scope.view, scope.requestPage, id]);
}

export function inventoryKey(colony: string, filter: InventoryFilter): string {
	return JSON.stringify([colony, inventoryFilterSchema.parse(filter)]);
}
