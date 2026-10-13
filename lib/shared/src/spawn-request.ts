import type { Bead, BeadComment } from "@hive/beads";
import type { Recipe } from "./bees.ts";
import { recipeSchema } from "./bees.ts";
import { z } from "zod";

const FIRST = 0;
const NONE = 0;
const STATE_LABEL_COUNT = 2;
const NONEMPTY = 1;
const BEFORE = -1;
const AFTER = 1;
const EQUAL = 0;
/** An explicit native resolution fact, separate from historical execution observations. */
export const BEE_ACKNOWLEDGMENT_PREFIX = "Bee acknowledgment:";
export const acknowledgmentSchema = z.strictObject({
	/** Exact native closure timestamp to which acceptance applies. */
	closedAt: z.string().min(NONEMPTY),
	/** Operator explanation, captured once and retained on repeat calls. */
	reason: z.string().trim().min(NONEMPTY),
});
/** Native labels used to discover spawn requests, independently of their validity. */
export const SPAWN_REQUEST_LABELS = ["system", "bee"] as const;
/** Native comments are timestamped evidence, never a live execution-status authority. */
export const COLONY_OBSERVATION_PREFIX = "Colony observation:";
/** Stdout evidence is separate from lifecycle observations and never execution authority. */
export const COLONY_STDOUT_PREFIX = "Colony stdout activity:";
export const stdoutActivitySchema = z.strictObject({
	/** Immutable execution attempt identifier, not a harness session. */
	attemptId: z.string(),
	/** Human-readable attempt ordinal within this request. */
	attemptNumber: z.number().int().positive(),
	/** Last write to a nonempty stdout log; null means no output observed. */
	lastOutputAt: z.iso.datetime({ precision: 3 }).nullable(),
	/** Publication time, kept distinct from the source output time. */
	recordedAt: z.iso.datetime({ precision: 3 }),
});
export type StdoutActivity = z.infer<typeof stdoutActivitySchema>;
/** Durable request lifecycle vocabulary; transitions remain owned by Colony. */
export const requestStateSchema = z.enum([
	"waiting",
	"claiming",
	"executing",
	"settling",
	"retrying",
	"terminal",
]);
/** Settled request outcomes are distinct from individual worker exit states. */
export const requestOutcomeSchema = z.enum([
	"completed",
	"cancelled",
	"exhausted",
	"claim_failed",
	"blocked",
]);

/** Workflow execution scope is captured independently of the harness recipe. */
export const workflowAssignmentSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		/** Coordinates an existing run; Busy Bee owns its closure. */
		kind: z.literal("driver"),
		/** Native run bead serving as the completion anchor. */
		runId: z.string().trim().min(NONEMPTY),
	}),
	z.strictObject({
		/** Performs one automatic visit without navigating the workflow. */
		kind: z.literal("stage"),
		/** Native run containing the visit. */
		runId: z.string().trim().min(NONEMPTY),
		/** Native visit bead whose work this execution performs. */
		stageId: z.string().trim().min(NONEMPTY),
	}),
]);
const capturedRequestSchema = recipeSchema.extend({
	host: z.string().trim().min(NONEMPTY).optional(),
	assignment: workflowAssignmentSchema,
});
export type WorkflowAssignment = z.infer<typeof workflowAssignmentSchema>;

/** Queryable request facts, independent of attempt and checkpoint states. */
export type SpawnDisposition =
	| {
			/** Work is still requested, including automatic retries. */
			outcome: "pending";
			/** Pending work has no terminal resolution. */
			resolution: "unresolved";
	  }
	| {
			/** Completion or deliberate cancellation ends the request. */
			outcome: "succeeded" | "cancelled";
			/** These outcomes need no failure intervention. */
			resolution: "resolved";
	  }
	| {
			/** Terminal unsuccessful execution retains its historical outcome. */
			outcome: "failed";
			/** Acknowledgment or replacement resolves attention without changing the outcome. */
			resolution: "unresolved" | "resolved";
	  };

export interface SpawnRequest {
	/** Captured coordination or work scope, independent of execution defaults. */
	assignment: WorkflowAssignment;
	/** Native identifier of the bead representing this request. */
	id: string;
	/** Friendly identity preserved across all attempts to fulfil the request. */
	identity: string;
	/** Requesting hostname; null identifies unbound history, never local execution authority. */
	host: string | null;
	/** Instructions and execution attributes captured when the request was submitted. */
	recipe: Recipe;
	/** Related task beads whose completion determines the request's success. */
	taskIds: string[];
}

/** Failure attention is independent of the retained native outcome. */
export type RequestResolution =
	| {
			/** No completion, cancellation, acknowledgment or replacement resolves this request. */
			kind: "unresolved";
	  }
	| {
			/** Completion or intentional cancellation needs no intervention. */
			kind: "resolved";
	  }
	| {
			/** An explicit native acknowledgment accepts this failed closure. */
			kind: "acknowledged";
	  }
	| {
			/** A successfully created replacement resolves the original failure. */
			kind: "superseded";
			/** Native incoming supersedes links identify replacement requests. */
			replacementIds: string[];
	  };

export interface RequestAcknowledgment {
	/** Native comment author credited with accepting the failure. */
	actor: string;
	/** Native comment timestamp, preserved at its recorded precision. */
	acknowledgedAt: string;
	/** Recorded explanation for accepting the failure. */
	reason: string;
}

/** Encode the classification required for a spawn request of this kind. */
export function spawnRequestLabels(kind: string): string[] {
	return [
		...SPAWN_REQUEST_LABELS,
		`agent:${kind}`,
		"bee-outcome:pending",
		"bee-resolution:unresolved",
	];
}

/** Interpret the Beads representation once, before request-specific decisions. */
export function readSpawnRequest(bead: Bead): SpawnRequest {
	const request = {
		...readSpawnRequestSummary(bead),
		taskIds: bead.dependencies
			.filter(({ dependency_type }) => dependency_type === "related")
			.map(({ id }) => id),
	};
	let anchor = request.assignment.runId;
	if (request.assignment.kind === "stage") {
		anchor = request.assignment.stageId;
	}
	if (request.taskIds.length !== NONEMPTY || request.taskIds.at(FIRST) !== anchor) {
		throw new Error(
			`Request ${bead.id} does not link exactly its ${request.assignment.kind} anchor`,
		);
	}
	return request;
}

/** Decode list-visible request facts without pretending relationship detail was loaded. */
export function readSpawnRequestSummary(
	bead: Pick<Bead, "id" | "description" | "labels" | "assignee">,
): Omit<SpawnRequest, "taskIds"> {
	const { host, assignment, ...recipe } = capturedRequestSchema.parse(JSON.parse(bead.description));
	if (
		![...SPAWN_REQUEST_LABELS, `agent:${recipe.kind}`].every((label) => bead.labels.includes(label))
	) {
		throw new Error(`Request ${bead.id} lacks exact spawn labels`);
	}
	if (!bead.assignee) {
		throw new Error(`Request ${bead.id} has no friendly identity`);
	}
	return {
		assignment,
		id: bead.id,
		identity: bead.assignee,
		// Missing provenance remains explicitly unbound for historical inspection.
		// eslint-disable-next-line unicorn/no-null
		host: host ?? null,
		recipe,
	};
}

/** Immutable timestamps survive imports; same-second ties are deterministic, not causal order. */
export function latestColonyObservation(bead: Bead): BeadComment | undefined {
	return bead.comments
		.filter(({ text }) => text.startsWith(COLONY_OBSERVATION_PREFIX))
		.toSorted((left, right) => compareComments(right, left))
		.at(FIRST);
}

/** Publication time selects the current attempt, even when it has produced no stdout. */
export function latestStdoutActivity(bead: Bead): StdoutActivity | undefined {
	return bead.comments
		.filter(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX))
		.map(({ text }) =>
			stdoutActivitySchema.parse(JSON.parse(text.slice(COLONY_STDOUT_PREFIX.length))),
		)
		.toSorted(compareActivities)
		.at(FIRST);
}

/** Read explicit acceptance for this failed closure, independently of later supersession. */
export function requestAcknowledgment(bead: Bead): RequestAcknowledgment | undefined {
	if (requestOutcome(bead) !== "failed") {
		return undefined;
	}
	const comments = bead.comments
		.filter(({ text }) => text.startsWith(BEE_ACKNOWLEDGMENT_PREFIX))
		.toSorted(compareComments);
	for (const comment of comments) {
		const record = acknowledgmentSchema.parse(
			JSON.parse(comment.text.slice(BEE_ACKNOWLEDGMENT_PREFIX.length)),
		);
		if (record.closedAt === bead.closed_at) {
			return { acknowledgedAt: comment.created_at, actor: comment.author, reason: record.reason };
		}
	}
	return undefined;
}

/** Read resolution from native closure, acknowledgment and distinct supersession edges. */
// Keep the independent native resolution facts and their precedence together.
// eslint-disable-next-line max-statements
export function requestResolution(bead: Bead): RequestResolution {
	const outcome = requestOutcome(bead);
	if (outcome === "pending") {
		return { kind: "unresolved" };
	}
	if (outcome !== "failed") {
		return { kind: "resolved" };
	}
	const replacements = bead.dependents.filter(
		({ dependency_type }) => dependency_type === "supersedes",
	);
	if (replacements.length > NONE) {
		return { kind: "superseded", replacementIds: replacements.map(({ id }) => id) };
	}
	if (requestAcknowledgment(bead)) {
		return { kind: "acknowledged" };
	}
	return { kind: "unresolved" };
}

/** Native closure is authoritative; arbitrary operator close reasons mean cancellation. */
export function requestOutcome(bead: Bead): SpawnDisposition["outcome"] {
	if (bead.status !== "closed") {
		return "pending";
	}
	if (bead.close_reason === "completed") {
		return "succeeded";
	}
	if (
		bead.close_reason === "exhausted" ||
		bead.close_reason === "claim_failed" ||
		bead.close_reason === "blocked"
	) {
		return "failed";
	}
	return "cancelled";
}

/** One mapping drives Bee inspection and the native query projection. */
export function requestDisposition(bead: Bead): SpawnDisposition {
	const outcome = requestOutcome(bead);
	if (outcome === "pending") {
		return { outcome, resolution: "unresolved" };
	}
	if (outcome === "failed" && requestResolution(bead).kind === "unresolved") {
		return { outcome, resolution: "unresolved" };
	}
	return { outcome, resolution: "resolved" };
}

/** Replace both projection namespaces together, retaining unrelated classifications. */
export function projectedRequestLabels(bead: Bead): string[] {
	const { outcome, resolution } = requestDisposition(bead);
	return [
		...bead.labels.filter((label) => !isStateLabel(label)),
		`bee-outcome:${outcome}`,
		`bee-resolution:${resolution}`,
	];
}

/** A partial native publication is visible without mutating during inspection. */
export function requestLabelsCurrent(bead: Bead): boolean {
	const { outcome, resolution } = requestDisposition(bead);
	return (
		bead.labels.filter(isStateLabel).length === STATE_LABEL_COUNT &&
		bead.labels.includes(`bee-outcome:${outcome}`) &&
		bead.labels.includes(`bee-resolution:${resolution}`)
	);
}

/** Only settled unsuccessful requests require intervention. */
export function requestNeedsAttention(bead: Bead): boolean {
	const disposition = requestDisposition(bead);
	return disposition.outcome === "failed" && disposition.resolution === "unresolved";
}

// --- Private functions ---
function compareActivities(left: StdoutActivity, right: StdoutActivity): number {
	const time = compareText(right.recordedAt, left.recordedAt);
	if (time !== EQUAL) {
		return time;
	}
	return compareText(JSON.stringify(right), JSON.stringify(left));
}

function compareText(left: string, right: string): number {
	if (left < right) {
		return BEFORE;
	}
	if (left > right) {
		return AFTER;
	}
	return EQUAL;
}

/** Native comment IDs are local; these immutable fields preserve ordering across imports. */
function compareComments(left: BeadComment, right: BeadComment): number {
	for (const key of ["created_at", "author", "text"] as const) {
		if (left[key] < right[key]) {
			return BEFORE;
		}
		if (left[key] > right[key]) {
			return AFTER;
		}
	}
	return EQUAL;
}

function isStateLabel(label: string): boolean {
	return label.startsWith("bee-outcome:") || label.startsWith("bee-resolution:");
}
