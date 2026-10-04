import { TOML } from "bun";
import { z } from "zod";

const MIN_CHOICES = 2;
const MAX_CHOICES = 255;
const MIN_ENTRIES = 1;
const MIN_PROBABILITY = 0;
const MAX_PROBABILITY = 1;
const nonblank = z.string().regex(/\S/u, "Must not be blank");
const identifier = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const classifierId = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const probability = z.number().min(MIN_PROBABILITY).max(MAX_PROBABILITY);
const questionSchema = z.strictObject({
	criteria: z.record(identifier, nonblank).refine((criteria) => {
		const count = Object.keys(criteria).length;
		return count >= MIN_CHOICES && count <= MAX_CHOICES;
	}, "A choice question needs 2–255 criteria"),
	instructions: nonblank,
	type: z.literal("choice"),
});
const definitionSchema = z.strictObject({
	description: nonblank,
	inputs: z.record(identifier, nonblank).refine(hasEntries, "Declare at least one input"),
	questions: z
		.record(identifier, questionSchema)
		.refine(hasEntries, "Declare at least one question"),
	version: z.number().int().positive(),
});

export interface Classifier {
	/** Filename without the .toml extension. */
	id: string;
	/** Validated discovery text, input descriptions and questions. */
	definition: z.infer<typeof definitionSchema>;
}

export interface ClassificationRequest {
	/** Explicit JEV model requested for this execution. */
	model: string;
	/** Caller-supplied evidence, validated against the declared inputs. */
	state: Record<string, string>;
	/** Named choice questions sent together over the same evidence. */
	questions: Classifier["definition"]["questions"];
}

export function validateClassifierId(id: string): string {
	return classifierId.parse(id);
}

export function parseClassifier(id: string, source: string): Classifier {
	try {
		return { definition: definitionSchema.parse(TOML.parse(source)), id };
	} catch (error) {
		throw new Error(`Invalid classifier ${id}: ${errorMessage(error)}`, { cause: error });
	}
}

export function prepareRequest(classifier: Classifier, input: string): ClassificationRequest {
	const shape = Object.fromEntries(
		Object.keys(classifier.definition.inputs).map((name) => [name, nonblank]),
	);
	try {
		return {
			model: "jev-latest",
			questions: classifier.definition.questions,
			state: z.strictObject(shape).parse(JSON.parse(input)),
		};
	} catch (error) {
		throw new Error(`Invalid input for ${classifier.id}: ${errorMessage(error)}`, { cause: error });
	}
}

export function parseClassification(request: ClassificationRequest, value: unknown) {
	const answers = Object.fromEntries(
		Object.entries(request.questions).map(([name, question]) => {
			const labels = Object.keys(question.criteria);
			const probabilities = Object.fromEntries(labels.map((label) => [label, probability]));
			return [
				name,
				z.strictObject({
					choice: z.enum(labels),
					confidence: probability,
					probabilities: z.strictObject(probabilities),
					type: z.literal("choice"),
				}),
			];
		}),
	);
	// Probabilities are rounded by the provider; do not require an exact sum of one.
	return z
		.object({
			answers: z.strictObject(answers),
			model: nonblank,
			usage: z.object({
				input_tokens: z.number().int().nonnegative(),
				output_tokens: z.number().int().nonnegative(),
			}),
		})
		.parse(value);
}

// --- Private functions ---

function hasEntries(value: Record<string, unknown>): boolean {
	return Object.keys(value).length >= MIN_ENTRIES;
}

function errorMessage(error: unknown): string {
	if (error instanceof z.ZodError) {
		return z.prettifyError(error);
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
