import type { ClassificationRequest, Classifier } from "../src/classifiers.ts";
import { parseClassification, prepareRequest } from "../src/classifiers.ts";
import { z } from "zod";

const ZERO = 0;
const ONE = 1;
const nonblank = z.string().regex(/\S/u);
const probability = z.number().min(ZERO).max(ONE);
const range = z.tuple([probability, probability]).refine(([min, max]) => min <= max);
const fixtureSchema = z.strictObject({
	id: nonblank,
	input: z.record(nonblank, nonblank),
	expected: z.strictObject({
		choice: nonblank,
		probabilities: z.record(nonblank, range),
	}),
	rationale: nonblank,
});

type Fixture = z.infer<typeof fixtureSchema>;
type Classification = ReturnType<typeof parseClassification>;

export interface EvaluationTarget {
	/** Named choice question whose answers the suite evaluates. */
	question: string;
	/** Category whose probability is the requested score. */
	scoreLabel: string;
}

export interface PreparedFixture {
	/** Validated question selected when preparing the fixture. */
	question: string;
	/** Review expectations retained locally, never included in the request state. */
	fixture: Fixture;
	/** Validated source evidence and classifier questions. */
	request: ClassificationRequest;
}

export interface EvaluationRow {
	/** Stable fixture identity for matching results to the reviewed evidence. */
	id: string;
	/** Expected choice and inclusive probability intervals. */
	expected: Fixture["expected"];
	/** True when both choice and every declared interval match. */
	passed: boolean;
	/** Failed expectations, empty for a passing case. */
	mismatches: string[];
	/** Fingerprint of the exact provider request, excluding expectations. */
	request_hash: string;
	/** Full validated answers, actual provider model and usage. */
	result: Classification;
}

export function prepareFixtures(
	classifier: Classifier,
	target: EvaluationTarget,
	values: readonly unknown[],
): PreparedFixture[] {
	const { question, scoreLabel } = target;
	const definition = classifier.definition.questions[question];
	if (!definition) {
		throw new Error(`Unknown evaluation question: ${question}`);
	}
	const labels = new Set(Object.keys(definition.criteria));
	if (!labels.has(scoreLabel) || values.length === ZERO) {
		throw new Error("Evaluation requires a declared score label and at least one fixture");
	}
	const ids = new Set<string>();
	return values.map((value) => {
		const fixture = fixtureSchema.parse(value);
		if (ids.has(fixture.id)) {
			throw new Error(`Duplicate fixture: ${fixture.id}`);
		}
		ids.add(fixture.id);
		const expectedLabels = [
			fixture.expected.choice,
			...Object.keys(fixture.expected.probabilities),
		];
		if (expectedLabels.some((label) => !labels.has(label))) {
			throw new Error(`Unknown expected label in fixture: ${fixture.id}`);
		}
		if (
			!fixture.expected.probabilities[fixture.expected.choice] ||
			!fixture.expected.probabilities[scoreLabel]
		) {
			throw new Error(
				`Fixture needs intervals for its expected choice and ${scoreLabel}: ${fixture.id}`,
			);
		}
		return {
			fixture,
			question,
			request: prepareRequest(classifier, JSON.stringify(fixture.input)),
		};
	});
}

export async function evaluateFixture(
	prepared: PreparedFixture,
	classify: (request: ClassificationRequest) => Promise<unknown>,
): Promise<EvaluationRow> {
	const { fixture, question, request } = prepared;
	const result = parseClassification(request, await classify(request));
	const answer = result.answers[question]!;
	const mismatches = compareAnswer(fixture.expected, answer);
	return {
		id: fixture.id,
		expected: fixture.expected,
		passed: mismatches.length === ZERO,
		mismatches,
		request_hash: new Bun.CryptoHasher("sha256").update(JSON.stringify(request)).digest("hex"),
		result,
	};
}

export function compareAnswer(
	expected: Fixture["expected"],
	actual: { choice: string; probabilities: Record<string, number> },
): string[] {
	const mismatches: string[] = [];
	if (actual.choice !== expected.choice) {
		mismatches.push(`choice: expected ${expected.choice}, received ${actual.choice}`);
	}
	for (const [label, [min, max]] of Object.entries(expected.probabilities)) {
		const value = actual.probabilities[label]!;
		if (value < min || value > max) {
			mismatches.push(`${label}: expected [${min}, ${max}], received ${value}`);
		}
	}
	return mismatches;
}
