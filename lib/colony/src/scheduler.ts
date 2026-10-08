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

export interface CapacityConstraint {
	/** Policy dimension limiting admission. */
	scope: "colony" | "kind" | "worktree";
	/** Number of retained reservations counted in this dimension. */
	used: number;
	/** Effective limit, including named-kind overrides. */
	maximum: number;
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
	occupied: readonly Occupant[],
	limits: BeesConfig["limits"],
): boolean {
	return capacityConstraints(candidate, occupied, limits).every(
		({ used, maximum }) => used < maximum,
	);
}

/** Ranking can select admissions only when individually feasible requests cannot all fit. */
export function hasContention(
	candidates: readonly Occupant[],
	occupied: readonly Occupant[],
	limits: BeesConfig["limits"],
): boolean {
	const projected = [...occupied];
	for (const candidate of candidates.filter((item) => hasCapacity(item, occupied, limits))) {
		if (!hasCapacity(candidate, projected, limits)) {
			return true;
		}
		projected.push(candidate);
	}
	return false;
}

/** The exact capacity constraints used by dispatch, with counts for read-only diagnostics. */
export function capacityConstraints(
	candidate: Occupant,
	occupied: readonly Occupant[],
	limits: BeesConfig["limits"],
): CapacityConstraint[] {
	return [
		{ maximum: limits.colony, scope: "colony", used: occupied.length },
		{
			maximum: limits.kinds[candidate.kind] ?? limits.kind,
			scope: "kind",
			used: occupied.filter(({ kind }) => kind === candidate.kind).length,
		},
		{
			maximum: limits.worktree,
			scope: "worktree",
			used: occupied.filter(({ bucket }) => bucket === candidate.bucket).length,
		},
	];
}
