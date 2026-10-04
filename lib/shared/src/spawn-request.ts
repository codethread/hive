import type { Bead, BeadComment } from "./bees-io.ts";
import type { Recipe } from "./bees.ts";
import { recipeSchema } from "./bees.ts";
import { z } from "zod";

const FIRST = 0;
/** Native labels used to discover spawn requests, independently of their validity. */
export const SPAWN_REQUEST_LABELS = ["system", "bee"] as const;
/** Native comments are timestamped evidence, never a live execution-status authority. */
export const COLONY_OBSERVATION_PREFIX = "Colony observation:";
/** Durable request lifecycle vocabulary; transitions remain owned by Ghost. */
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
