import type { Bead, BeadComment } from "./bees-io.ts";
import type { Recipe } from "./bees.ts";
import { recipeSchema } from "./bees.ts";
import { z } from "zod";

const FIRST = 0;
const NONE = 0;
/** Native labels used to discover spawn requests, independently of their validity. */
export const SPAWN_REQUEST_LABELS = ["system", "bee"] as const;
/** Native comments are timestamped evidence, never a live execution-status authority. */
export const COLONY_OBSERVATION_PREFIX = "Colony observation:";
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
export const requestOutcomeSchema = z.enum(["completed", "cancelled", "exhausted", "claim_failed"]);

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
	return [...SPAWN_REQUEST_LABELS, `agent:${kind}`];
}

/** Interpret the Beads representation once, before request-specific decisions. */
export function readSpawnRequest(bead: Bead): SpawnRequest {
	const recipe = recipeSchema.parse(JSON.parse(bead.description));
	if (!spawnRequestLabels(recipe.kind).every((label) => bead.labels.includes(label))) {
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

/** Read resolution from native closure and distinct supersession edges. */
export function requestResolution(bead: Bead): RequestResolution {
	const replacements = bead.dependents.filter(
		({ dependency_type }) => dependency_type === "supersedes",
	);
	if (replacements.length > NONE) {
		return { kind: "superseded", replacementIds: replacements.map(({ id }) => id) };
	}
	if (
		bead.status === "closed" &&
		(bead.close_reason === "completed" ||
			bead.close_reason === "cancelled" ||
			bead.close_reason === "Stopped by Bee")
	) {
		return { kind: "resolved" };
	}
	return { kind: "unresolved" };
}

/** Only settled unsuccessful requests require intervention. */
export function requestNeedsAttention(bead: Bead): boolean {
	return (
		bead.status === "closed" &&
		(bead.close_reason === "exhausted" || bead.close_reason === "claim_failed") &&
		requestResolution(bead).kind === "unresolved"
	);
}
