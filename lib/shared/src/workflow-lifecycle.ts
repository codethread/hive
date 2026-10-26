import type { Bead, BeadRecord, BeadsScope, BeadsService } from "@hive/beads";
import { z } from "zod";

const FORMAT_VERSION = 2;
const NONEMPTY = 1;
const FIRST = 0;
const text = z.string().min(NONEMPTY);
const scopeSchema = z.enum(["run", "visit", "group"]);
export const WORKFLOW_OUTCOME_PREFIX = "workflow-outcome:";
export const managedExecutionSchema = z.enum(["unmanaged", "managed"]);
const completionFields = {
	/** Native generated work role. */
	scope: scopeSchema,
	/** Intended execution disposition, independent of authored choice. */
	outcome: z.enum(["succeeded", "failed", "cancelled"]),
	/** Generated readable close prose; consumers never parse its grammar. */
	reason: text,
};
export const workflowCompletionSchema = z.discriminatedUnion("state", [
	z.object({ ...completionFields, state: z.literal("requested") }),
	z.object({ ...completionFields, state: z.literal("confirmed"), closedAt: text }),
]);
export type WorkflowCompletion = z.infer<typeof workflowCompletionSchema>;
export const workflowSettlementIntentSchema = z.object({
	/** Explicit unsuccessful operation, never an authored choice. */
	operation: z.enum(["cancel", "fail"]),
	/** Operator explanation retained by the completion writer. */
	reason: text,
	/** Complete only after required native projections are confirmed. */
	state: z.enum(["pending", "complete"]),
	/** Exact generated scope inspected for this settlement, run last. */
	inventory: z.array(z.object({ id: text, scope: scopeSchema })),
});
export type WorkflowSettlementIntent = z.infer<typeof workflowSettlementIntentSchema>;

const ownershipSchema = z.object({ owner: text, pid: z.number().int().positive() });
const resultSchema = z.object({ choice: text, data: z.unknown() });
const createdScopeSchema = z.enum(["visit", "group"]);
const createdSchema = z.object({ bead: text, scope: createdScopeSchema });
const formatSchema = z.object({ formatVersion: z.unknown().optional() });

/** Consumed control only; Busy Bee owns the opaque definition and XState body. */
export const workflowControlSchema = z.object({
	/** Engine encoding, independent of workflow SemVer. */
	formatVersion: z.literal(FORMAT_VERSION),
	/** Native run identity. */
	id: text,
	/** Short publication ownership window; PID is diagnostic, not takeover proof. */
	lock: ownershipSchema.nullable(),
	/** Monotonic execution exposure; absence is not unmanaged evidence. */
	managedExecution: managedExecutionSchema,
	/** Immutable original command inputs, keyed by native visit ID. */
	results: z.record(z.string(), resultSchema),
	/** Completion intentions and native projection witnesses, keyed by native bead ID. */
	completions: z.record(z.string(), workflowCompletionSchema),
	/** Durable admission fence, independent of chart and native status. */
	settlement: workflowSettlementIntentSchema.nullable(),
	/** Published inventory retains explicit scope even after leaving the frontier. */
	created: z.array(createdSchema),
});
export type WorkflowControl = z.infer<typeof workflowControlSchema>;
const workflowFactSchema = z.object({ ...completionFields, runId: text });
const mismatchReasonSchema = z.enum([
	"unconfirmed_completion",
	"native_open",
	"closure_mismatch",
	"unauthorized_closure",
]);
export const nativeWorkflowStateSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("pending") }),
	z.object({
		kind: z.literal("mismatch"),
		reason: mismatchReasonSchema,
		completion: workflowCompletionSchema.nullable(),
	}),
	z.object({ kind: z.literal("terminal"), closedAt: text, fact: workflowFactSchema }),
]);
export type NativeWorkflowState = z.infer<typeof nativeWorkflowStateSchema>;
export interface WorkflowControlObservation {
	/** Native system identity and update time provide consumer freshness. */
	checkpoint: BeadRecord;
	/** Validated consumed control, not the executable workflow body. */
	control: WorkflowControl;
}
export class WorkflowControlError extends Error {
	/** Stable diagnosis without parsing error prose. */
	readonly reason: "unsupported_workflow_format" | "invalid_workflow_control";
	/** Identity of the selected native workflow run. */
	readonly runId: string;
	/** Known system identity, absent for relationship selection failures. */
	readonly checkpoint: string | undefined;
	constructor(
		message: string,
		context: {
			reason: WorkflowControlError["reason"];
			runId: string;
			checkpoint?: string;
			cause?: unknown;
		},
	) {
		super(message, { cause: context.cause });
		this.name = "WorkflowControlError";
		this.reason = context.reason;
		this.runId = context.runId;
		this.checkpoint = context.checkpoint;
	}
}

/** Select exactly one related system record without importing a workflow definition. */
export async function readWorkflowControl(
	beads: Pick<BeadsService, "showMany">,
	scope: BeadsScope,
	run: Pick<BeadRecord, "id" | "dependencies">,
): Promise<WorkflowControlObservation> {
	const ids = run.dependencies
		.filter((edge) => edge.dependency_type === "related")
		.map((edge) => edge.id);
	const related = await beads.showMany(scope, [...new Set(ids)]);
	const checkpoints = related.filter(
		(record) => record.labels.includes("system") && record.labels.includes("busybee-checkpoint"),
	);
	if (checkpoints.length !== NONEMPTY) {
		throw new WorkflowControlError(
			`Workflow ${run.id} needs exactly one related system checkpoint; found ${checkpoints.length}.`,
			{ reason: "invalid_workflow_control", runId: run.id },
		);
	}
	const checkpoint = checkpoints[FIRST]!;
	return { checkpoint, control: parseWorkflowControl(checkpoint, run.id) };
}

/** Reject old formats before callers consider mutation; never read ordinary notes. */
// eslint-disable-next-line max-statements -- Keep format diagnosis and identity-scoped decoding at one boundary.
export function parseWorkflowControl(
	checkpoint: Pick<BeadRecord, "id" | "description">,
	runId: string,
): WorkflowControl {
	let raw: unknown = undefined;
	try {
		raw = JSON.parse(checkpoint.description) as unknown;
	} catch (error) {
		throw new WorkflowControlError(
			`Checkpoint ${checkpoint.id} for workflow ${runId} has invalid JSON.`,
			{
				reason: "invalid_workflow_control",
				runId,
				checkpoint: checkpoint.id,
				cause: error,
			},
		);
	}
	const format = formatSchema.safeParse(raw, { jitless: true }).data?.formatVersion;
	if (format !== FORMAT_VERSION) {
		throw new WorkflowControlError(
			`Checkpoint ${checkpoint.id} for workflow ${runId} has unsupported format ${String(format)}; ` +
				"finish with matching old tools, or deliberately start a fresh format-2 run within existing " +
				"authorization after inspecting prior effects and preserving evidence. Old-run disposition " +
				"and live cutover need their own authority. No migration or automatic cutover is performed.",
			{ reason: "unsupported_workflow_format", runId, checkpoint: checkpoint.id },
		);
	}
	const parsed = workflowControlSchema.safeParse(raw, { jitless: true });
	if (!parsed.success || parsed.data.id !== runId) {
		throw new WorkflowControlError(
			`Checkpoint ${checkpoint.id} has invalid control for workflow ${runId}.`,
			{
				reason: "invalid_workflow_control",
				runId,
				checkpoint: checkpoint.id,
				cause: parsed.error,
			},
		);
	}
	return parsed.data;
}

/** Join system intention with current native projection, never with labels or reason grammar. */
// eslint-disable-next-line max-statements -- Join ordered completion/projection variants without inferring authority.
export function nativeWorkflowState(
	record: Pick<Bead, "id" | "status" | "closed_at" | "close_reason">,
	expected: { runId: string; scope: "run" | "visit" | "group" },
	control: WorkflowControl,
): NativeWorkflowState {
	assertMembership(record.id, expected, control);
	const completion = control.completions[record.id];
	if (!completion) {
		if (record.status === "closed") {
			// eslint-disable-next-line unicorn/no-null -- Wire mismatch explicitly has no intended completion.
			return { kind: "mismatch", reason: "unauthorized_closure", completion: null };
		}
		return { kind: "pending" };
	}
	if (completion.scope !== expected.scope) {
		throw new WorkflowControlError(`Completion scope disagrees with workflow task ${record.id}.`, {
			reason: "invalid_workflow_control",
			runId: expected.runId,
		});
	}
	if (completion.state === "requested") {
		return { kind: "mismatch", reason: "unconfirmed_completion", completion };
	}
	if (record.status !== "closed") {
		return { kind: "mismatch", reason: "native_open", completion };
	}
	if (record.closed_at !== completion.closedAt || record.close_reason !== completion.reason) {
		return { kind: "mismatch", reason: "closure_mismatch", completion };
	}
	return {
		kind: "terminal",
		closedAt: completion.closedAt,
		fact: {
			scope: completion.scope,
			outcome: completion.outcome,
			reason: completion.reason,
			runId: control.id,
		},
	};
}

/** Query projection only; an unconfirmed or mismatched projection is never terminal. */
export function workflowOutcomeLabels(labels: string[], state: NativeWorkflowState): string[] {
	const unrelated = labels.filter((label) => !label.startsWith(WORKFLOW_OUTCOME_PREFIX));
	if (state.kind === "terminal") {
		unrelated.push(`${WORKFLOW_OUTCOME_PREFIX}${state.fact.outcome}`);
	}
	return unrelated;
}

/** Missing, duplicate or stale labels are visible independently of system outcome. */
export function workflowOutcomeLabelsCurrent(
	labels: string[],
	state: NativeWorkflowState,
): boolean {
	return (
		JSON.stringify(labels.toSorted()) ===
		JSON.stringify(workflowOutcomeLabels(labels, state).toSorted())
	);
}

// --- Private functions ---
function assertMembership(
	id: string,
	expected: { runId: string; scope: "run" | "visit" | "group" },
	control: WorkflowControl,
): void {
	const entries = control.created.filter((entry) => entry.bead === id);
	const isRun = expected.scope === "run" && id === control.id && entries.length === FIRST;
	const isCreated =
		expected.scope !== "run" &&
		id !== control.id &&
		entries.length === NONEMPTY &&
		entries[FIRST]!.scope === expected.scope;
	if (control.id !== expected.runId || (!isRun && !isCreated)) {
		throw new WorkflowControlError(
			`Task ${id} is not a known ${expected.scope} of workflow ${expected.runId}.`,
			{
				reason: "invalid_workflow_control",
				runId: expected.runId,
			},
		);
	}
}
