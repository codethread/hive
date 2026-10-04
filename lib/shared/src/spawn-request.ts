import type { Bead, BeadComment } from "./bees-io.ts";
import type { Recipe } from "./bees.ts";
import { recipeSchema } from "./bees.ts";
import { z } from "zod";

const FIRST = 0;
const NONE = 0;
const STATE_LABEL_COUNT = 2;
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
			/** A replacement resolves the original failure without changing its outcome. */
			resolution: "unresolved" | "resolved";
	  };

export interface SpawnRequest {
	/** Native identifier of the bead representing this request. */
	id: string;
	/** Friendly identity preserved across all attempts to fulfil the request. */
	identity: string;
	/** Instructions and execution attributes captured when the request was submitted. */
	recipe: Recipe;
	/** Related task beads whose completion determines the request's success. */
	taskIds: string[];
}

/** Failure attention is independent of the retained native outcome. */
export type RequestResolution =
	| {
			/** No completion, cancellation or replacement resolves this request. */
			kind: "unresolved";
	  }
	| {
			/** Completion or intentional cancellation needs no intervention. */
			kind: "resolved";
	  }
	| {
			/** A successfully created replacement resolves the original failure. */
			kind: "superseded";
			/** Native incoming supersedes links identify replacement requests. */
			replacementIds: string[];
	  };

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
	const recipe = recipeSchema.parse(JSON.parse(bead.description));
	if (
		![...SPAWN_REQUEST_LABELS, `agent:${recipe.kind}`].every((label) => bead.labels.includes(label))
	) {
		throw new Error(`Request ${bead.id} lacks exact spawn labels`);
	}
	if (!bead.assignee) {
		throw new Error(`Request ${bead.id} has no friendly identity`);
	}
	return {
		id: bead.id,
		identity: bead.assignee,
		recipe,
		taskIds: bead.dependencies
			.filter(({ dependency_type }) => dependency_type === "related")
			.map(({ id }) => id),
	};
}

/** Native comment IDs distinguish observations recorded within the same second. */
export function latestColonyObservation(bead: Bead): BeadComment | undefined {
	return bead.comments
		.filter(({ text }) => text.startsWith(COLONY_OBSERVATION_PREFIX))
		.toSorted((left, right) => right.id - left.id)
		.at(FIRST);
}

/** Comment order selects the current attempt, even when it has produced no stdout. */
export function latestStdoutActivity(bead: Bead): StdoutActivity | undefined {
	const comment = bead.comments
		.filter(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX))
		.toSorted((left, right) => right.id - left.id)
		.at(FIRST);
	if (!comment) {
		return undefined;
	}
	return stdoutActivitySchema.parse(JSON.parse(comment.text.slice(COLONY_STDOUT_PREFIX.length)));
}

/** Read resolution from native closure and distinct supersession edges. */
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
function isStateLabel(label: string): boolean {
	return label.startsWith("bee-outcome:") || label.startsWith("bee-resolution:");
}
