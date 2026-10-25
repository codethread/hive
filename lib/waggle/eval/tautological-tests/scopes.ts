const ACCEPTANCE_PROBABILITY = 0.9;
const FINAL_SCOPE = 3;
const NEXT_SCOPE = 1;

// eslint-disable-next-line no-magic-numbers -- Public scope levels are literal protocol values.
export const SCOPES = [1, 2, 3] as const;
export type Scope = (typeof SCOPES)[number];

export const REVIEW_CHOICES = ["tautological", "behavioral", "mixed", "needs_context"] as const;
export type ReviewChoice = (typeof REVIEW_CHOICES)[number];
export type ScoreMetric = "probability" | "confidence";

export interface ReviewSignal {
	/** Validated category chosen by JEV. */
	choice: ReviewChoice;
	/** Category probabilities reported by JEV. */
	probabilities: Record<ReviewChoice, number>;
	/** Separate provider confidence statistic. */
	confidence: number;
}

export type ScopeDecision =
	| { kind: "accepted" }
	| { kind: "expand"; scope: Scope }
	| { kind: "unresolved" };

/**
 * Pure stopping decision for one validated result and an explicit score metric.
 * `accepted` means the 0.90 threshold was met, not correctness or deletion authority.
 * `needs_context` expands when possible; scope 3 otherwise remains unresolved.
 */
export function decideScope(
	scope: Scope,
	signal: ReviewSignal,
	metric: ScoreMetric,
): ScopeDecision {
	let score = signal.probabilities[signal.choice];
	if (metric === "confidence") {
		score = signal.confidence;
	}
	if (signal.choice !== "needs_context" && score >= ACCEPTANCE_PROBABILITY) {
		return { kind: "accepted" };
	}
	if (scope === FINAL_SCOPE) {
		return { kind: "unresolved" };
	}
	return { kind: "expand", scope: (scope + NEXT_SCOPE) as Scope };
}
