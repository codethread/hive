import type { Bead } from "@hive/beads";
import { z } from "zod";

const FORMAT_VERSION = 1;
const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const FIRST = 0;
const BEFORE = -1;
const AFTER = 1;
const EQUAL = 0;
export const WORKFLOW_ACKNOWLEDGMENT_PREFIX = "Busy Bee acknowledgment:";
export const WORKFLOW_SETTLEMENT_PREFIX = "Busy Bee settlement:";
const settlementEntrySchema = z.strictObject({
	id: text,
	scope: z.enum(["visit", "group"]),
	updatedAt: text,
});
export const workflowSettlementIntentSchema = z.strictObject({
	/** Invocation retaining publication ownership until settlement completes. */
	owner: text,
	/** Native workflow whose generated inventory was inspected. */
	runId: text,
	/** Requested unsuccessful disposition; success requires authored completion. */
	operation: z.enum(["cancel", "fail"]),
	/** Operator explanation retained in each native closure. */
	reason: text,
	/** Existing replacement run, when explicitly supplied. */
	replacementId: text.nullable(),
	/** Inspected generated work, excluding already-closed preserved descendants. */
	inventory: z.array(settlementEntrySchema),
});
export type WorkflowSettlementIntent = z.infer<typeof workflowSettlementIntentSchema>;
export const workflowAcknowledgmentSchema = z.strictObject({
	/** Exact native closure timestamp accepted by this acknowledgment. */
	closedAt: text,
	/** Exact native closure bytes, independent of the operator's explanation. */
	closeReason: text,
	/** Operator explanation for accepting the failed execution. */
	reason: z.string().trim().min(NONEMPTY),
});

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

export const workflowResolutionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unresolved") }),
	z.object({ kind: z.literal("resolved") }),
	z.object({
		kind: z.literal("acknowledged"),
		actor: text,
		acknowledgedAt: text,
		reason: text,
	}),
	z.object({ kind: z.literal("superseded"), replacementIds: z.array(text).min(NONEMPTY) }),
]);
export type WorkflowResolution = z.infer<typeof workflowResolutionSchema>;
export const nativeWorkflowStateSchema = z.discriminatedUnion("kind", [
	pendingSchema,
	unavailableSchema,
	terminalSchema,
]);
export type NativeWorkflowState = z.infer<typeof nativeWorkflowStateSchema>;

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
		/** An unfinished settlement fences execution independently of lock cleanup. */
		settlement: z.enum(["none", "pending"]),
	}),
	/** Classification derived from native status and closure facts. */
	lifecycle: nativeWorkflowStateSchema,
	/** Follow-up provenance never rewrites the terminal execution outcome. */
	resolution: workflowResolutionSchema,
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

/** Match native facts to their actual closure and expected workflow scope. */
export function nativeWorkflowState(
	record: Pick<Bead, "id" | "status" | "closed_at" | "close_reason">,
	expected: Pick<WorkflowClosure, "runId" | "scope">,
): NativeWorkflowState {
	const fact = parseWorkflowClosure(record.close_reason);
	if (
		fact &&
		(record.status !== "closed" ||
			!record.closed_at ||
			fact.scope !== expected.scope ||
			fact.runId !== expected.runId)
	) {
		throw new Error(`Native closure fact disagrees with workflow task ${record.id}.`);
	}
	if (record.status !== "closed") {
		return { kind: "pending" };
	}
	if (!fact) {
		return { kind: "unavailable", reason: "unclassified_closure" };
	}
	return { kind: "terminal", closedAt: record.closed_at!, fact };
}

/** Resolve follow-up through native links or exact-closure acknowledgments. */
export function workflowResolution(
	record: Bead,
	lifecycle: NativeWorkflowState,
): WorkflowResolution {
	if (lifecycle.kind !== "terminal") {
		return { kind: "unresolved" };
	}
	if (lifecycle.fact.outcome === "succeeded") {
		return { kind: "resolved" };
	}
	const replacementIds = record.dependents
		.filter(({ dependency_type }) => dependency_type === "supersedes")
		.map(({ id }) => id)
		.toSorted();
	if (replacementIds.length > FIRST) {
		return { kind: "superseded", replacementIds };
	}
	if (lifecycle.fact.outcome === "cancelled") {
		return { kind: "resolved" };
	}
	return workflowAcknowledgment(record) ?? { kind: "unresolved" };
}

/** Deterministic acknowledgment selection retains all native comments as evidence. */
export function workflowAcknowledgment(
	record: Bead,
): Extract<WorkflowResolution, { kind: "acknowledged" }> | undefined {
	const comments = record.comments
		.filter(({ text: value }) => value.startsWith(WORKFLOW_ACKNOWLEDGMENT_PREFIX))
		.toSorted((left, right) => {
			const leftKey = `${left.created_at}\0${left.author}\0${left.text}`;
			const rightKey = `${right.created_at}\0${right.author}\0${right.text}`;
			if (leftKey < rightKey) {
				return BEFORE;
			}
			if (leftKey > rightKey) {
				return AFTER;
			}
			return EQUAL;
		});
	for (const comment of comments) {
		const acknowledgment = workflowAcknowledgmentSchema.parse(
			JSON.parse(comment.text.slice(WORKFLOW_ACKNOWLEDGMENT_PREFIX.length)),
		);
		if (
			acknowledgment.closedAt === record.closed_at &&
			acknowledgment.closeReason === record.close_reason
		) {
			return {
				kind: "acknowledged",
				actor: comment.author,
				acknowledgedAt: comment.created_at,
				reason: acknowledgment.reason,
			};
		}
	}
	return undefined;
}

/** Run notes carry a bounded intent, never an alternative terminal outcome. */
export function parseWorkflowSettlement(notes: string): WorkflowSettlementIntent | undefined {
	const intents = notes.split("\n").filter((line) => line.startsWith(WORKFLOW_SETTLEMENT_PREFIX));
	if (intents.length === FIRST) {
		return undefined;
	}
	if (intents.length !== NONEMPTY) {
		throw new Error("Multiple workflow settlement intents require explicit recovery.");
	}
	return workflowSettlementIntentSchema.parse(
		JSON.parse(intents[FIRST]!.slice(WORKFLOW_SETTLEMENT_PREFIX.length)),
	);
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
