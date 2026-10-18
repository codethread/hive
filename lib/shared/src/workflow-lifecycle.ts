import { z } from "zod";

const FORMAT_VERSION = 1;
const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);

/** Native close_reason payload, recorded by the same close operation as closed_at. */
export const workflowClosureSchema = z.compile(
	z.object({
		/** Identifies a structured workflow closure within native close_reason text. */
		kind: z.literal("busybee-lifecycle"),
		/** Closure payload version, independent of the engine checkpoint format. */
		formatVersion: z.literal(FORMAT_VERSION),
		/** Role of the native bead closed by this operation. */
		scope: z.enum(["run", "visit", "group"]),
		/** Owning workflow run, including for visit and group closures. */
		runId: text,
		/** Completion disposition, independent of an authored worker choice. */
		outcome: z.enum(["succeeded", "failed", "cancelled"]),
		/** Explanation recorded by the closing operation. */
		reason: text,
	}),
);

export type WorkflowClosure = z.infer<typeof workflowClosureSchema>;

/** The identified native run is not closed. */
const pendingSchema = z.object({ kind: z.literal("pending") });
const unavailableSchema = z.object({
	/** Native closure has no recognized workflow disposition. */
	kind: z.literal("unavailable"),
	/** An unmarked historical closure is not inferred to have succeeded. */
	reason: z.literal("unclassified_closure"),
});
const terminalSchema = z.object({
	/** Native closure carries a valid fact matching the inspected run. */
	kind: z.literal("terminal"),
	/** Native closed_at timestamp recorded with the closure fact. */
	closedAt: text,
	/** Parsed native close_reason payload. */
	fact: workflowClosureSchema,
});

export const workflowLifecycleSchema = z.object({
	/** Native ID of the inspected workflow run. */
	runId: text,
	/** Native task status, separate from workflow disposition. */
	nativeStatus: text,
	/** Native run update time, separate from checkpoint freshness. */
	updatedAt: text,
	/** Observed checkpoint publication state, separate from native closure. */
	publication: z.object({
		/** Related workflow system bead holding the checkpoint. */
		checkpoint: text,
		/** Native checkpoint update time, including lock bookkeeping. */
		savedAt: text,
		/** Observed checkpoint lock; does not establish worker liveness. */
		locked: z.boolean(),
	}),
	/** Classification derived from native status and closure facts. */
	lifecycle: z.discriminatedUnion("kind", [pendingSchema, unavailableSchema, terminalSchema]),
});

export type WorkflowLifecycle = z.infer<typeof workflowLifecycleSchema>;

/** Decode tagged native closure facts; ordinary historic reasons have no lifecycle classification. */
export function parseWorkflowClosure(reason: string | undefined): WorkflowClosure | undefined {
	if (!reason) {
		return undefined;
	}
	const value = parseReason(reason);
	if (
		typeof value !== "object" ||
		value === null ||
		!("kind" in value) ||
		value.kind !== "busybee-lifecycle"
	) {
		return undefined;
	}
	return workflowClosureSchema.parse(value);
}

// --- Private functions ---

function parseReason(reason: string): unknown {
	try {
		return JSON.parse(reason) as unknown;
	} catch (error) {
		if (reason.includes("busybee-lifecycle")) {
			throw error;
		}
		return undefined;
	}
}
