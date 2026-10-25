import { expect, test } from "bun:test";
import { decideScope } from "../../eval/tautological-tests/scopes.ts";

const OTHER_CATEGORIES = 3;
const CERTAIN = 1;

test.each([
	{ scope: 1, choice: "behavioral", probability: 0.9, expected: { kind: "accepted" } },
	{ scope: 1, choice: "tautological", probability: 0.89, expected: { kind: "expand", scope: 2 } },
	{ scope: 2, choice: "mixed", probability: 0.5, expected: { kind: "expand", scope: 3 } },
	{ scope: 1, choice: "needs_context", probability: 0.99, expected: { kind: "expand", scope: 2 } },
	{ scope: 3, choice: "needs_context", probability: 0.99, expected: { kind: "unresolved" } },
	{ scope: 3, choice: "behavioral", probability: 0.8, expected: { kind: "unresolved" } },
	{ scope: 3, choice: "mixed", probability: 0.95, expected: { kind: "accepted" } },
] as const)(
	"decides progressive scope from $choice at $probability in scope $scope",
	({ scope, choice, probability, expected }) => {
		expect(
			decideScope(
				scope,
				{
					choice,
					probabilities: {
						tautological: (CERTAIN - probability) / OTHER_CATEGORIES,
						behavioral: (CERTAIN - probability) / OTHER_CATEGORIES,
						mixed: (CERTAIN - probability) / OTHER_CATEGORIES,
						needs_context: (CERTAIN - probability) / OTHER_CATEGORIES,
						[choice]: probability,
					},
					confidence: 0.1,
				},
				"probability",
			),
		).toEqual(expected);
	},
);

const FIRST_SCOPE = 1;
const SECOND_SCOPE = 2;

test("uses the explicit provider metric without confusing it with category probability", () => {
	const signal = {
		choice: "behavioral" as const,
		probabilities: { tautological: 0.03, behavioral: 0.95, mixed: 0.01, needs_context: 0.01 },
		confidence: 0.4,
	};
	expect(decideScope(FIRST_SCOPE, signal, "confidence")).toEqual({ kind: "expand", scope: 2 });
	expect(
		decideScope(
			SECOND_SCOPE,
			{ ...signal, choice: "needs_context", confidence: 0.99 },
			"confidence",
		),
	).toEqual({ kind: "expand", scope: 3 });
});
