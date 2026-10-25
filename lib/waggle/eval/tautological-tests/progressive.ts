import type { ClassificationRequest, Classifier } from "../../src/classifiers.ts";
import { REVIEW_CHOICES, SCOPES, decideScope } from "./scopes.ts";
import type { ReviewSignal, Scope, ScopeDecision, ScoreMetric } from "./scopes.ts";
import { parseClassification, prepareRequest } from "../../src/classifiers.ts";
import type { Evidence } from "./extraction.ts";

type Classification = ReturnType<typeof parseClassification>;
export interface PreparedScope {
	/** Supported scope in the requested contiguous suffix. */
	scope: Scope;
	/** Validated request built from the fixed evidence snapshot. */
	request: ClassificationRequest;
}
export type PreparedProgressive = PreparedScope[];

export interface ProgressiveOptions {
	/** First scope to execute; lower scopes are skipped. */
	scope: Scope;
	/** Explicit stopping statistic; the caller owns any default. */
	metric: ScoreMetric;
}

export interface ProgressiveAttempt {
	/** Whether this scope contacted the provider or reused identical earlier evidence. */
	disposition: "evaluated" | "reused";
	/** Evidence scope used for this completed classification. */
	scope: Scope;
	/** SHA-256 fingerprint of the exact serialized provider request. */
	request_hash: string;
	/** Validated answers, actual model and token usage, without invented results. */
	result: Classification;
	/** Stopping policy decision for this attempt, not a correctness guarantee. */
	decision: ScopeDecision;
}

export interface ProgressiveResult {
	/** Final stopping decision; acceptance does not authorize test deletion. */
	kind: "accepted" | "unresolved";
	/** Every completed attempt in increasing scope order, not a best-score selection. */
	attempts: ProgressiveAttempt[];
}

/** Prepare all evidence before any provider call. Callers must keep requests frozen during execution. */
export function prepareProgressive(
	classifier: Classifier,
	inputForScope: (scope: Scope) => Evidence,
	startScope: Scope,
): PreparedProgressive {
	const { review } = classifier.definition.questions;
	const labels = Object.keys(review?.criteria ?? {});
	if (
		labels.length !== REVIEW_CHOICES.length ||
		!REVIEW_CHOICES.every((label) => labels.includes(label))
	) {
		throw new Error(
			"Progressive classification requires the four tautological-tests review labels",
		);
	}
	return SCOPES.filter((scope) => scope >= startScope).map((scope) => ({
		scope,
		request: prepareRequest(classifier, JSON.stringify(inputForScope(scope))),
	}));
}

/** Execute once per scope, stopping immediately on acceptance, exhaustion or a ProgressiveError. */
// eslint-disable-next-line max-statements -- Keep sequential stopping and contextual failure handling together.
export async function runProgressive(
	prepared: PreparedProgressive,
	options: ProgressiveOptions,
	classify: (request: ClassificationRequest) => Promise<unknown>,
): Promise<ProgressiveResult> {
	const attempts: ProgressiveAttempt[] = [];
	let decision: ScopeDecision = { kind: "expand", scope: options.scope };
	while (decision.kind === "expand") {
		const { scope } = decision;
		const { request } = prepared.find((step) => step.scope === scope)!;
		const request_hash = new Bun.CryptoHasher("sha256")
			.update(JSON.stringify(request))
			.digest("hex");
		const previous = attempts.find((attempt) => attempt.request_hash === request_hash);
		let result = previous?.result;
		let disposition: ProgressiveAttempt["disposition"] = "reused";
		if (!result) {
			disposition = "evaluated";
			try {
				// eslint-disable-next-line no-await-in-loop -- Earlier evidence determines whether another call is allowed.
				result = parseClassification(request, await classify(request));
			} catch (error) {
				throw new ProgressiveError({ scope, request_hash }, attempts, error);
			}
		}
		// Preparation verified the exact review label set; the response was parsed once above.
		decision = decideScope(
			scope,
			result.answers.review! as unknown as ReviewSignal,
			options.metric,
		);
		attempts.push({ scope, request_hash, result, decision, disposition });
	}
	return { kind: decision.kind, attempts };
}

export class ProgressiveError extends Error {
	/** Scope whose provider call or response validation failed; never retried. */
	readonly scope: Scope;
	/** Fingerprint of the failed request, even when no valid response exists. */
	readonly request_hash: string;
	/** Completed attempts before the failure; the failed attempt has no invented result. */
	readonly attempts: readonly ProgressiveAttempt[];

	constructor(
		failed: Pick<ProgressiveAttempt, "scope" | "request_hash">,
		attempts: readonly ProgressiveAttempt[],
		cause: unknown,
	) {
		super(`Progressive classification failed at scope ${failed.scope}`, { cause });
		this.name = "ProgressiveError";
		this.scope = failed.scope;
		this.request_hash = failed.request_hash;
		this.attempts = attempts;
	}
}
