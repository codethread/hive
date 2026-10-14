/* eslint-disable unicorn/max-nested-calls -- Log boundary variants keep each response explicit. */
import { z } from "zod";

export const logQuerySchema = z.object({
	/** Retained attempt ID; absent selects current/latest inspection evidence. */
	attempt: z.string().min(1).optional(),
	/** Byte cursor within the selected file; never a filesystem path. */
	cursor: z.coerce.number().int().nonnegative().default(0),
	/** Preview, chronological event page, or a bounded raw-detail chunk. */
	mode: z.enum(["preview", "page", "raw"]).default("preview"),
	/** Detail end offset obtained from the selected event. */
	end: z.coerce.number().int().nonnegative().optional(),
	/** Separate evidence streams, never interleaved. */
	stream: z.enum(["stdout", "stderr"]).default("stdout"),
});
export const logAttemptSchema = z.object({
	/** Retained execution attempt ID. */
	id: z.string(),
	/** One-based ordinal within this request. */
	number: z.number().int().positive(),
	/** Native receipt time, not an event timestamp. */
	createdAt: z.string(),
	/** Retained attempt state, not a live process probe. */
	state: z.string(),
	/** Captured harness identifies the native log format. */
	harness: z.string(),
});
export const logEntrySchema = z.object({
	/** Byte start and end delimit complete source lines, excluding newline. */
	offset: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	/** Native kind when readable, otherwise an explicit text/unfamiliar marker. */
	kind: z.string(),
	/** Compact readable content; complete evidence remains available through raw chunks. */
	content: z.string(),
	/** Native event time only; absent time stays explicitly unavailable. */
	timestamp: z.string().nullable(),
});
const selection = {
	/** Only this request's retained attempts, projected without local paths or receipts. */
	attempts: z.array(logAttemptSchema),
	/** Selected retained execution, or null when no launch exists. */
	attempt: logAttemptSchema.nullable(),
};
export const logResponseSchema = z.discriminatedUnion("kind", [
	z.object({
		...selection,
		/** Complete entries in source order, bounded per response. */
		entries: z.array(logEntrySchema),
		/** Next chronological page, or null at the last complete entry. */
		next: z.number().int().nonnegative().nullable(),
		/** An actively written final line is withheld until complete. */
		incompleteTail: z.boolean(),
		kind: z.literal("page"),
	}),
	z.object({
		...selection,
		/** Missing retained file or no retained launch, independently of an empty log. */
		kind: z.literal("missing"),
		message: z.string(),
	}),
	z.object({
		...selection,
		/** Bounded inert raw text from the selected log only. */
		text: z.string(),
		/** Next byte chunk for this detail, or null when complete. */
		next: z.number().int().nonnegative().nullable(),
		kind: z.literal("raw"),
	}),
]);
export type LogQuery = z.infer<typeof logQuerySchema>;
export type LogResponse = z.infer<typeof logResponseSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;

export function logKey(colony: string, request: string, query: LogQuery): string {
	return JSON.stringify([colony, request, query]);
}
