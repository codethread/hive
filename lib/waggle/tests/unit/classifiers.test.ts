import { expect, test } from "bun:test";
import {
	parseClassification,
	parseClassifier,
	prepareRequest,
	validateClassifierId,
} from "../../src/classifiers.ts";

const source = await Bun.file(new URL("../fixtures/example.toml", import.meta.url)).text();
const classifier = parseClassifier("example", source);
const request = prepareRequest(
	classifier,
	JSON.stringify({ evidence: "  source stays verbatim\n" }),
);
const result = {
	answers: {
		review: {
			choice: "concern",
			confidence: 0.6,
			probabilities: { concern: 0.8, no_concern: 0.19 },
			type: "choice",
		},
	},
	model: "jev-1.13.0",
	usage: { input_tokens: 100, output_tokens: 20 },
} satisfies ReturnType<typeof parseClassification>;

test("TOML discovery metadata stays local and evidence reaches named questions unchanged", () => {
	expect(classifier.definition.inputs).toEqual({
		evidence: "The relevant source and caller contract.",
	});
	expect(request).toEqual({
		model: "jev-latest",
		questions: classifier.definition.questions,
		state: { evidence: "  source stays verbatim\n" },
	});
	expect(request).not.toHaveProperty("description");
});

test.each([
	["malformed TOML", "not = [valid"],
	[
		"missing description",
		source.replace('description = "Assess evidence against a stated contract."', ""),
	],
	["unknown top-level field", `unexpected = true\n${source}`],
	["unsupported question type", source.replace('type = "choice"', 'type = "score"')],
	["one choice", source.replace('no_concern = "The supplied contract supports the design."', "")],
])("rejects %s before execution", (_name, input) => {
	expect(() => parseClassifier("example", input)).toThrow(Error);
});

test.each([
	["invalid JSON", "{"],
	["missing evidence", "{}"],
	["unknown input", '{"evidence":"x","extra":"y"}'],
	["wrong input type", '{"evidence":42}'],
	["blank evidence", '{"evidence":"  "}'],
])("rejects %s instead of fabricating context", (_name, input) => {
	expect(() => prepareRequest(classifier, input)).toThrow(Error);
});

test.each(["../secret", "/absolute", "nested/example", "example.toml"])(
	"rejects escaping or non-ID name %s",
	(id) => {
		expect(() => validateClassifierId(id)).toThrow(Error);
	},
);

test("preserves rounded probabilities and the actual provider model", () => {
	expect(parseClassification(request, result)).toEqual(result);
});

test.each([
	["missing question", { ...result, answers: {} }],
	[
		"invented label",
		{ ...result, answers: { review: { ...result.answers.review, choice: "approved" } } },
	],
	[
		"missing probability",
		{ ...result, answers: { review: { ...result.answers.review, probabilities: { concern: 1 } } } },
	],
	[
		"out-of-range confidence",
		{ ...result, answers: { review: { ...result.answers.review, confidence: 2 } } },
	],
])("rejects provider result with %s #test-459", (_name, value) => {
	expect(() => parseClassification(request, value)).toThrow(Error);
});
