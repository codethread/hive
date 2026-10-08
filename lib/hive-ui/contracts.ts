/* eslint-disable unicorn/max-nested-calls -- Boundary schemas keep complete discriminated variants visible together. */
import { z } from "zod";

export const PAGE_SIZE = 60;
export const boardFilterSchema = z.object({
	all: z.array(z.string().min(1)).default([]),
	any: z.array(z.string().min(1)).default([]),
	closed: z.boolean().default(false),
	exclude: z.array(z.string().min(1)).default([]),
	page: z.number().int().nonnegative().default(0),
	query: z.string().default(""),
});
export const navigationSchema = boardFilterSchema.extend({ bead: z.string().optional() });
export const colonySchema = z.object({
	beadsDb: z.string(),
	id: z.string(),
	name: z.string(),
	root: z.string(),
});
export const coloniesSchema = z.object({ colonies: z.array(colonySchema) });
export const observationSchema = z.object({ at: z.string(), author: z.string(), text: z.string() });
export const beeSchema = z.object({
	harness: z.string(),
	id: z.string(),
	identity: z.string(),
	kind: z.string(),
	model: z.string(),
	observation: observationSchema.nullable(),
	requester: z.string().nullable(),
	status: z.string(),
	taskIds: z.array(z.string()),
});
export const cardSchema = z.object({
	assignee: z.string().nullable(),
	bees: z.array(beeSchema),
	id: z.string(),
	labels: z.array(z.string()),
	priority: z.number().int(),
	status: z.string(),
	title: z.string(),
	updatedAt: z.string(),
});
export const boardSchema = z.object({
	bees: z.array(beeSchema),
	cards: z.array(cardSchema),
	fetchedAt: z.string(),
	hasMore: z.boolean(),
	inventoryReadAt: z.string(),
	labels: z.array(z.string()),
	/** Exact argv preview; the server executes it without a shell. */
	query: z.array(z.string()),
});
export const detailSchema = z.object({
	card: cardSchema,
	/** Comments load only with the selected bead, never in board responses. */
	comments: z.array(observationSchema.extend({ id: z.number().int() })),
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

export type Colony = z.infer<typeof colonySchema>;
export type BoardFilter = z.infer<typeof boardFilterSchema>;
export type Navigation = z.infer<typeof navigationSchema>;
export type Bee = z.infer<typeof beeSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Detail = z.infer<typeof detailSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;

/** Exact native label semantics, including literal commas and case. */
export function taskQuery(filter: BoardFilter, taskIds: string[]): string[] {
	let args = ["list"];
	if (filter.query) {
		args = ["search", filter.query];
	}
	for (const [values, flag] of [
		[taskIds, "--id"],
		[filter.all, "--label"],
		[filter.any, "--label-any"],
		[["system", ...filter.exclude], "--exclude-label"],
	] as const) {
		args.push(...values.flatMap((value) => [flag, value]));
	}
	if (filter.closed) {
		args.push("--all");
	}
	args.push(
		"--deferred",
		"--sort",
		"priority",
		"--limit",
		String(PAGE_SIZE + 1),
		"--offset",
		String(filter.page * PAGE_SIZE),
	);
	return args;
}

export function boardKey(colony: string, filter: BoardFilter): string {
	return JSON.stringify([colony, filter]);
}
