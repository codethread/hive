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
	/** Optional direction for this execution; task beads own the assignment. */
	prompt: z.string().default(""),
	/** Reusable role and protocol instructions, independent of the execution prompt. */
	system_prompt: z.string().default(""),
});
export const invocationSchema = z.strictObject({
	argv: z.array(z.string()),
	executable: z.string().min(NONEMPTY),
});
export const formulaSchema = invocationSchema.extend({
	/** Argument templates prepended for Colony's headless executions. */
	headless: z.array(z.string()).default([]),
});
const kindFields = {
	...recipeSchema.omit({ cwd: true, kind: true }).shape,
	/** Short selection guidance for the requesting agent. */
	description: z.string().trim().min(NONEMPTY),
	/** Omit from ordinary discovery unless the caller explicitly allows it. */
	hidden: z.boolean().default(false),
	/** Workflow selected for new public assignments, separate from execution attributes. */
	workflow: z.string().trim().min(NONEMPTY).default("do-work"),
};
const kindSelectors = z.array(z.string().min(NONEMPTY));
/** Caller-owned discovery guidance, independent of execution recipes and admission. */
export const kindSchema = z.union([
	z.strictObject({ ...kindFields, allow: kindSelectors }),
	z.strictObject({ ...kindFields, deny: kindSelectors }),
	z.strictObject(kindFields),
]);
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
	/** Automatic audit kind and ongoing native health parent; null disables new batches. */
	auto_nurse: z
		.strictObject({ kind: z.string().min(NONEMPTY), parent: z.string().min(NONEMPTY) })
		.nullable()
		// eslint-disable-next-line unicorn/no-null -- Null is the canonical disabled policy value.
		.default(null),
	formulas: z.record(z.string(), formulaSchema),
	humans: z.array(z.string().min(NONEMPTY)),
	/** Named kind used for one-shot reviews after fifteen minutes without stdout; null disables reviews. */
	// eslint-disable-next-line unicorn/no-null -- No configured drone means inactivity review is disabled.
	inactivity_drone: z.string().min(NONEMPTY).nullable().default(null),
	kinds: z.record(z.string(), kindSchema).default({}),
	/** Named advisory inspector for settled launched requests; null disables enrollment. */
	// eslint-disable-next-line unicorn/no-null -- Optional advisory execution is disabled by default.
	post_run_drone: z.string().min(NONEMPTY).nullable().default(null),
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
export type BeeKind = z.infer<typeof kindSchema>;
export type Formula = z.infer<typeof formulaSchema>;
export type Invocation = z.infer<typeof invocationSchema>;
export type BeesConfig = z.infer<typeof beesConfigSchema>;
export type Limits = z.infer<typeof limitsSchema>;
export type PolicyChange = z.infer<typeof policyChangeSchema>;

/** Parse every formula eagerly; Handlebars.compile itself defers syntax checking. */
export function parseBeesConfig(text: string): BeesConfig {
	const config = beesConfigSchema.parse(Bun.TOML.parse(text));
	validateBeesConfig(config);
	return config;
}
/** Validate the complete effective configuration after kind sources have been combined. */
// eslint-disable-next-line max-statements -- Validate effective kind references and formula syntax together.
export function validateBeesConfig(config: BeesConfig): void {
	if (config.auto_nurse !== null) {
		const nurse = config.kinds[config.auto_nurse.kind];
		if (!nurse || !config.formulas[nurse.harness]) {
			throw new Error(
				`Automatic nurse ${config.auto_nurse.kind} requires a configured kind and formula`,
			);
		}
	}
	for (const [name, kind] of Object.entries(config.kinds)) {
		let selectors: string[] = [];
		if ("allow" in kind) {
			selectors = kind.allow;
		} else if ("deny" in kind) {
			selectors = kind.deny;
		}
		for (const selector of selectors) {
			if (selector !== "#self" && !Object.hasOwn(config.kinds, selector)) {
				throw new Error(`Unknown kind selector ${selector} in ${name}`);
			}
		}
	}
	if (config.post_run_drone !== null) {
		const inspector = config.kinds[config.post_run_drone];
		if (!inspector || !config.formulas[inspector.harness]) {
			throw new Error(
				`Post-run drone ${config.post_run_drone} requires a configured kind and formula`,
			);
		}
	}
	for (const formula of Object.values(config.formulas)) {
		validateFormula(formula);
	}
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
		system_prompt: "validation",
	};
	for (const prompt of ["", "validation"]) {
		for (const system_prompt of ["", "validation"]) {
			renderFormula(formula, { ...recipe, prompt, system_prompt }, "headless", "/validation-home");
			renderFormula(
				formula,
				{ ...recipe, cwd: ".", prompt, system_prompt },
				"headless",
				"/validation-home",
			);
		}
	}
}
/** Render tokens individually, omitting empty arguments; json quotes native config values. */
// Formula, recipe, invocation mode and host home are independent rendering inputs.
// eslint-disable-next-line max-params
export function renderFormula(
	formula: Formula,
	recipe: Recipe,
	mode: "interactive" | "headless",
	home: string,
): Invocation {
	const render = (token: string) =>
		Handlebars.compile(token, { noEscape: true, strict: true })(recipe, {
			helpers: { json: formulaJson },
		});
	let { argv } = formula;
	if (mode === "headless") {
		argv = [...formula.headless, ...argv];
	}
	let executable = render(formula.executable);
	if (executable.startsWith("~/")) {
		executable = `${home}${executable.slice("~".length)}`;
	}
	return invocationSchema.parse({
		argv: argv.map((token) => render(token)).filter((argument) => argument !== ""),
		executable,
	});
}

// --- Private functions ---
function formulaJson(value: unknown): string {
	// Handlebars does not enforce strict lookup for helper arguments.
	const json = JSON.stringify(value);
	if (json === undefined) {
		throw new Error("Formula json helper requires a defined value");
	}
	return json;
}
