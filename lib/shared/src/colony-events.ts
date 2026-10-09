/* eslint-disable unicorn/max-nested-calls -- Keep the public wire schema and field documentation together. */
import { repositoryEndpointSchema } from "./colony-protocol.ts";
import { requestOutcomeSchema } from "./spawn-request.ts";
import { z } from "zod";

const NONEMPTY = 1;
const MAX_COLONIES = 64;

/** A position in one durable event journal, independent of daemon restarts. */
export const colonyEventCursorSchema = z.strictObject({
	/** Persistent journal identity; replacing the state directory invalidates old cursors. */
	logId: z.uuid(),
	/** Last processed position; gaps from filtering are normal. */
	sequence: z.number().int().nonnegative(),
});

/** Public facts, separate from the daemon's diagnostic operation history. */
export const colonyEventTypeSchema = z.enum(["request.settled"]);

export const colonyEventSubscriptionSchema = z.strictObject({
	/** Exact canonical repository/tracker pairs; an empty selection is not a wildcard. */
	colonies: z.array(repositoryEndpointSchema).min(NONEMPTY).max(MAX_COLONIES),
	/** Event types selected on the server. */
	types: z.array(colonyEventTypeSchema).min(NONEMPTY).max(colonyEventTypeSchema.options.length),
	/** Fresh callers deliberately choose live events or all retained events. */
	start: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("live") }),
		z.strictObject({ kind: z.literal("retained") }),
		z.strictObject({ kind: z.literal("after"), cursor: colonyEventCursorSchema }),
	]),
});

/** Immutable settlement evidence; contains neither instructions nor process credentials. */
export const colonyEventSchema = z.strictObject({
	/** Stable replay and deduplication position. */
	cursor: colonyEventCursorSchema,
	/** A whole request settled; this does not assert that its process tree has stopped. */
	type: z.literal("request.settled"),
	/** Canonical repository and selected tracker that produced this event. */
	repository: repositoryEndpointSchema,
	/** Time Colony recorded the fact, not a worker exit timestamp. */
	recordedAt: z.iso.datetime({ precision: 3 }),
	/** Request identity, final outcome and references needed by advisory consumers. */
	request: z.strictObject({
		/** Spawn bead ID within this event's tracker. */
		id: z.string().min(NONEMPTY),
		/** Friendly identity retained across the request's execution attempts. */
		identity: z.string().min(NONEMPTY),
		/** Final request outcome, independent of individual attempt exits. */
		outcome: requestOutcomeSchema,
		/** Linked assignment IDs; native Beads remains their authority. */
		taskIds: z.array(z.string()),
		/** Retained attempt evidence, including failed preparation; consumers establish launch coverage. */
		attempts: z.array(
			z.strictObject({
				/** Immutable execution attempt ID. */
				id: z.string(),
				/** Local receipt path; raw receipts and their credentials are never streamed. */
				receiptPath: z.string(),
				/** Local stdout artifact; presence and coverage are established by the consumer. */
				stdoutPath: z.string(),
			}),
		),
	}),
});

export const colonyEventErrorSchema = z.strictObject({
	/** Explicit stream/request failure; consumers must not silently skip to the live tail. */
	kind: z.literal("error"),
	/** Machine-readable reason for failing this subscription. */
	code: z.enum([
		"invalid_subscription",
		"wrong_log",
		"cursor_expired",
		"future_cursor",
		"stream_failed",
	]),
	/** Diagnostic for the caller; does not contain source recipes or transcripts. */
	message: z.string(),
});

/** Checkpoints cover filtered-out events too, so quiet consumers can save their progress. */
export const colonyEventMessageSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("event"), event: colonyEventSchema }),
	z.strictObject({ kind: z.literal("checkpoint"), cursor: colonyEventCursorSchema }),
	colonyEventErrorSchema,
]);

export type ColonyEventCursor = z.infer<typeof colonyEventCursorSchema>;
export type ColonyEventSubscription = z.infer<typeof colonyEventSubscriptionSchema>;
export type ColonyEvent = z.infer<typeof colonyEventSchema>;
export type ColonyEventMessage = Exclude<
	z.infer<typeof colonyEventMessageSchema>,
	{ kind: "error" }
>;
export type ColonyEventError = z.infer<typeof colonyEventErrorSchema>;

/** One failed subscription, carrying the server's public error code. */
export class ColonyEventStreamError extends Error {
	readonly code: ColonyEventError["code"];
	constructor(error: ColonyEventError) {
		super(error.message);
		this.name = "ColonyEventStreamError";
		this.code = error.code;
	}
}
