import Handlebars from "handlebars";
import { z } from "zod";

const NONEMPTY = 1;
const DEFAULT_COLONY_MAXIMUM = 4;
const DEFAULT_KIND_MAXIMUM = 2;
const DEFAULT_WORKTREE_MAXIMUM = 2;
const MINIMUM_CAPACITY = 0;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAXIMUM_RETRY_DELAY_MS = 60_000;

export const recipeSchema = z.strictObject({
	cwd: z.string().min(NONEMPTY).nullable(),
	effort: z.string().min(NONEMPTY),
	harness: z.string().min(NONEMPTY),
	kind: z.string().min(NONEMPTY),
	model: z.string().min(NONEMPTY),
	prompt: z.string().min(NONEMPTY),
});
export const formulaSchema = z.strictObject({
	argv: z.array(z.string()),
	executable: z.string().min(NONEMPTY),
});
export const kindSchema = recipeSchema.omit({ cwd: true, kind: true });
export const limitsSchema = z.strictObject({
	/** Maximum live attempts in one registered repository. */
	colony: z.number().int().min(MINIMUM_CAPACITY).default(DEFAULT_COLONY_MAXIMUM),
	/** Default maximum for each requested kind. */
	kind: z.number().int().min(MINIMUM_CAPACITY).default(DEFAULT_KIND_MAXIMUM),
	/** Explicit per-kind maxima override the default kind maximum. */
	kinds: z.record(z.string(), z.number().int().min(MINIMUM_CAPACITY)).default({}),
	/** Maximum in each recorded launch worktree or external directory. */
	worktree: z.number().int().min(MINIMUM_CAPACITY).default(DEFAULT_WORKTREE_MAXIMUM),
});
const completeLimitsSchema = z.strictObject({
	colony: z.number().int().min(MINIMUM_CAPACITY),
	kind: z.number().int().min(MINIMUM_CAPACITY),
	kinds: z.record(z.string(), z.number().int().min(MINIMUM_CAPACITY)),
	worktree: z.number().int().min(MINIMUM_CAPACITY),
});
/** Runtime updates replace one named formula or the complete capacity settings. */
export const policyChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		formula: formulaSchema,
		kind: z.literal("formula"),
		name: z.string().min(NONEMPTY),
	}),
	z.strictObject({
		kind: z.literal("limits"),
		limits: completeLimitsSchema,
	}),
]);
export const beesConfigSchema = z.strictObject({
	formulas: z.record(z.string(), formulaSchema),
	humans: z.array(z.string().min(NONEMPTY)),
	kinds: z.record(z.string(), kindSchema),
	limits: limitsSchema.prefault({}),
	max_retries: z.number().int().min(MINIMUM_CAPACITY).default(DEFAULT_RETRIES),
	owner: z.string().min(NONEMPTY),
	ranking: z.enum(["bv-pagerank", "fifo"]).default("bv-pagerank"),
	retry_delay_ms: z
		.number()
		.int()
		.min(MINIMUM_CAPACITY)
		.max(MAXIMUM_RETRY_DELAY_MS)
		.default(DEFAULT_RETRY_DELAY_MS),
});
export type Recipe = z.infer<typeof recipeSchema>;
export type Formula = z.infer<typeof formulaSchema>;
export type BeesConfig = z.infer<typeof beesConfigSchema>;
export type Limits = z.infer<typeof limitsSchema>;
export type PolicyChange = z.infer<typeof policyChangeSchema>;

/** Parse every formula eagerly; Handlebars.compile itself defers syntax checking. */
export function parseBeesConfig(text: string): BeesConfig {
	const config = beesConfigSchema.parse(Bun.TOML.parse(text));
	for (const formula of Object.values(config.formulas)) {
		validateFormula(formula);
	}
	return config;
}
/** Compile and render the supported recipe shapes before installing a formula. */
export function validateFormula(formula: Formula): void {
	const recipe: Recipe = {
		// eslint-disable-next-line unicorn/no-null -- Check the canonical-default and explicit-directory recipe shapes.
		cwd: null,
		effort: "low",
		harness: "validation",
		kind: "worker",
		model: "validation",
		prompt: "validation",
	};
	renderFormula(formula, recipe);
	renderFormula(formula, { ...recipe, cwd: "." });
}
/** Render tokens individually; no shell interprets recipe values. */
export function renderFormula(formula: Formula, recipe: Recipe): Formula {
	const render = (token: string) =>
		Handlebars.compile(token, { noEscape: true, strict: true })(recipe);
	return formulaSchema.parse({
		argv: formula.argv.map(render),
		executable: render(formula.executable),
	});
}
