import type { Bead } from "@hive/beads";
import { z } from "zod";

const FORMAT_VERSION = 1;
const NONEMPTY = 1;
const text = z.string().min(NONEMPTY);
const FIRST = 0;
export const WORKFLOW_OUTCOME_PREFIX = "workflow-outcome:";
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
	/** Inspected generated work, excluding already-closed preserved descendants. */
	inventory: z.array(settlementEntrySchema),
});
export type WorkflowSettlementIntent = z.infer<typeof workflowSettlementIntentSchema>;
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

/** The identified native run, visit or group is not closed. */
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

export const nativeWorkflowStateSchema = z.discriminatedUnion("kind", [
	pendingSchema,
	unavailableSchema,
	terminalSchema,
]);
export type NativeWorkflowState = z.infer<typeof nativeWorkflowStateSchema>;

export const managedExecutionSchema = z.enum(["unmanaged", "managed"]);
const exposureHeaderSchema = z.object({
	formatVersion: z.literal(FORMAT_VERSION),
	id: text,
	managedExecution: managedExecutionSchema.optional(),
});

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
		if (reason.includes("busybee-lifecycle")) {
			throw new Error("Malformed marked workflow closure.");
		}
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

/** Query projection only; native closure remains authoritative. */
export function workflowOutcomeLabels(labels: string[], state: NativeWorkflowState): string[] {
	const unrelated = labels.filter((label) => !label.startsWith(WORKFLOW_OUTCOME_PREFIX));
	if (state.kind === "terminal") {
		unrelated.push(`${WORKFLOW_OUTCOME_PREFIX}${state.fact.outcome}`);
	}
	return unrelated;
}

/** Missing, duplicate or stale outcome labels are visible independently of the fact. */
export function workflowOutcomeLabelsCurrent(
	labels: string[],
	state: NativeWorkflowState,
): boolean {
	return (
		JSON.stringify(labels.toSorted()) ===
		JSON.stringify(workflowOutcomeLabels(labels, state).toSorted())
	);
}

/** A small consumed checkpoint provenance header, never the workflow snapshot. */
export function workflowManagedExposure(
	checkpoint: Pick<Bead, "description">,
	runId: string,
): "unmanaged" | "managed" | "unknown" {
	const header = exposureHeaderSchema.parse(JSON.parse(checkpoint.description));
	if (header.id !== runId) {
		throw new Error(`Checkpoint provenance disagrees with workflow ${runId}.`);
	}
	return header.managedExecution ?? "unknown";
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
