import type { BeesConfig } from "@hive/shared";

export interface CandidateOrder {
	/** Highest urgency among linked task beads, lower is more urgent. */
	priority: number;
	/** Spawn creation time, independent of preparation time. */
	createdAt: string;
	/** Stable spawn ID breaks timestamp ties. */
	id: string;
	/** Best linked-task PageRank, or zero in explicit FIFO mode. */
	score: number;
}
export interface Occupant {
	/** Requested kind, independent of executable formula. */
	kind: string;
	/** Worktree or external directory recorded at preparation. */
	bucket: string;
}

/** Native urgency always dominates graph ranking, with reproducible FIFO ties. */
export function compareCandidates(left: CandidateOrder, right: CandidateOrder): number {
	return (
		left.priority - right.priority ||
		right.score - left.score ||
		left.createdAt.localeCompare(right.createdAt) ||
		left.id.localeCompare(right.id)
	);
}
/** Existing occupants are never evicted when a configured maximum is lowered. */
export function hasCapacity(
	candidate: Occupant,
	occupied: Occupant[],
	limits: BeesConfig["limits"],
): boolean {
	const kindLimit = limits.kinds[candidate.kind] ?? limits.kind;
	return (
		occupied.length < limits.colony &&
		occupied.filter(({ kind }) => kind === candidate.kind).length < kindLimit &&
		occupied.filter(({ bucket }) => bucket === candidate.bucket).length < limits.worktree
	);
}
