import type { ClassificationRequest, parseClassification } from "../../src/classifiers.ts";
import { compareAnswer, evaluateFixture, prepareFixtures } from "../../eval/suite.ts";
import { expect, test } from "bun:test";
import { parseClassifier } from "../../src/classifiers.ts";

const MIN = 0.7;
const MAX = 0.9;
const ZERO = 0;
const ONE = 1;
const TWO = 2;

const classifier = parseClassifier(
	"example",
	await Bun.file(new URL("../fixtures/example.toml", import.meta.url)).text(),
);
const fixture = {
	id: "independent-expectation",
	input: { evidence: "source and selected test" },
	expected: { choice: "concern", probabilities: { concern: [MIN, MAX] } },
	rationale: "Locally reviewed expectation; not provider evidence.",
};

test.each([
	{ probability: 0.7, choice: "concern", failures: 0 },
	{ probability: 0.9, choice: "concern", failures: 0 },
	{ probability: 0.69, choice: "concern", failures: 1 },
	{ probability: 0.91, choice: "concern", failures: 1 },
	{ probability: 0.8, choice: "no_concern", failures: 1 },
	{ probability: 0.2, choice: "no_concern", failures: 2 },
])("choice $choice and probability $probability produce $failures mismatches", (row) => {
	const [prepared] = prepareFixtures(classifier, { question: "review", scoreLabel: "concern" }, [
		fixture,
	]);
	expect(
		compareAnswer(prepared!.fixture.expected, {
			choice: row.choice,
			probabilities: { concern: row.probability },
		}),
	).toHaveLength(row.failures);
});

test("evaluation keeps expectations private and retains provider evidence for a missed range", async () => {
	const [prepared] = prepareFixtures(classifier, { question: "review", scoreLabel: "concern" }, [
		fixture,
	]);
	const requests: ClassificationRequest[] = [];
	const result = {
		answers: {
			review: {
				choice: "no_concern",
				confidence: 0.3,
				probabilities: { concern: 0.2, no_concern: 0.8 },
				type: "choice",
			},
		},
		model: "jev-test",
		usage: { input_tokens: 10, output_tokens: 5 },
	} satisfies ReturnType<typeof parseClassification>;
	const row = await evaluateFixture(prepared!, (request) => {
		requests.push(request);
		return Promise.resolve(result);
	});
	expect(requests.map((request) => request.state)).toEqual([fixture.input]);
	expect(JSON.stringify(requests)).not.toContain('"expected"');
	expect(row).toMatchObject({ passed: false, result });
	expect(row.mismatches).toHaveLength(TWO);
	expect(row.request_hash).toMatch(/^[a-f0-9]{64}$/u);
});

test.each([
	{ name: "empty suite", fixtures: [] },
	{ name: "duplicate IDs", fixtures: [fixture, fixture] },
	{
		name: "missing score interval",
		fixtures: [
			{
				...fixture,
				expected: { choice: "no_concern", probabilities: { no_concern: [ZERO, ONE] } },
			},
		],
	},
	{
		name: "unknown label",
		fixtures: [
			{ ...fixture, expected: { choice: "invented", probabilities: { invented: [ZERO, ONE] } } },
		],
	},
	{
		name: "reversed interval",
		fixtures: [
			{ ...fixture, expected: { choice: "concern", probabilities: { concern: [MAX, MIN] } } },
		],
	},
	{
		name: "unexpected evidence field",
		fixtures: [{ ...fixture, input: { ...fixture.input, expected: "concern" } }],
	},
])("invalid suite with $name is rejected before classification", ({ fixtures }) => {
	expect(() =>
		prepareFixtures(classifier, { question: "review", scoreLabel: "concern" }, fixtures),
	).toThrow(Error);
});

test("provider failures remain failures rather than invented classifications", async () => {
	const [prepared] = prepareFixtures(classifier, { question: "review", scoreLabel: "concern" }, [
		fixture,
	]);
	await expect(
		evaluateFixture(prepared!, () => Promise.reject(new Error("unavailable"))),
	).rejects.toBeInstanceOf(Error);
	await expect(
		evaluateFixture(prepared!, () => Promise.resolve({ answers: {} })),
	).rejects.toBeInstanceOf(Error);
});
