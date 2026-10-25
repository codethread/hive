import type { ClassificationRequest, Classifier } from "../../src/classifiers.ts";
import {
	ProgressiveError,
	prepareProgressive,
	runProgressive,
} from "../../eval/tautological-tests/progressive.ts";
import { REVIEW_CHOICES, SCOPES } from "../../eval/tautological-tests/scopes.ts";
import { expect, test } from "bun:test";
import type { Evidence } from "../../eval/tautological-tests/extraction.ts";
import type { PreparedProgressive } from "../../eval/tautological-tests/progressive.ts";

const ZERO = 0;
const ONE_CALL = 1;
const FIRST_SCOPE = 1;
const classifier: Classifier = {
	id: "tautological-tests",
	definition: {
		version: 1,
		description: "Review selected tests",
		inputs: {
			source: "Implementation",
			test: "Selected case",
			context: "Helpers",
			contract: "Requirement",
		},
		questions: {
			review: {
				type: "choice",
				instructions: "Classify the selected test",
				criteria: {
					tautological: "Restates implementation",
					behavioral: "Independent observation",
					mixed: "Both",
					needs_context: "Unknown",
				},
			},
		},
	},
};
const inputs = {
	1: evidence("Selected case and hooks"),
	2: evidence("Selected case, hooks and enclosing suite"),
	3: evidence("Complete test file"),
};
// No evidence parsing is needed when testing a failed injected provider.
const prepared: PreparedProgressive = SCOPES.map((scope) => ({
	scope,
	request: request(inputs[scope]),
}));

test.each([...SCOPES])(
	"provider failure at initial scope %s stops without retry",
	async (scope) => {
		const cause = new Error("Provider unavailable");
		let calls = ZERO;
		const execution = runProgressive(prepared, { scope, metric: "probability" }, () => {
			calls += ONE_CALL;
			return Promise.reject(cause);
		});
		const failure: unknown = await execution.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(ProgressiveError);
		if (!(failure instanceof ProgressiveError)) {
			throw new Error("Expected contextual failure");
		}
		expect(failure).toMatchObject({ scope, cause, attempts: [] });
		expect(failure.request_hash).toMatch(/^[a-f0-9]{64}$/u);
		expect(calls).toBe(ONE_CALL);
	},
);

test.each([
	{ name: "missing category", labels: ["tautological", "behavioral", "mixed"] },
	{ name: "extra category", labels: [...REVIEW_CHOICES, "invented"] },
	{ name: "replaced category", labels: ["tautological", "behavioral", "mixed", "invented"] },
])("preparation rejects $name", ({ labels }) => {
	const invalid: Classifier = {
		...classifier,
		definition: {
			...classifier.definition,
			questions: {
				review: {
					...classifier.definition.questions.review!,
					criteria: Object.fromEntries(labels.map((label) => [label, label])),
				},
			},
		},
	};
	expect(() => prepareProgressive(invalid, (scope) => inputs[scope], FIRST_SCOPE)).toThrow(Error);
});

test("preparation requires a review question", () => {
	expect(() =>
		prepareProgressive(
			{ ...classifier, definition: { ...classifier.definition, questions: {} } },
			(scope) => inputs[scope],
			FIRST_SCOPE,
		),
	).toThrow(Error);
});

// --- Private helpers ---

function request(input: Evidence): ClassificationRequest {
	return {
		model: "jev-latest",
		questions: classifier.definition.questions,
		state: { ...input },
	};
}

function evidence(context: string): Evidence {
	return {
		source: "implementation",
		test: "selected case",
		context,
		contract: "independent requirement",
	};
}
