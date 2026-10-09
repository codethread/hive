import { expect, test } from "bun:test";
import { formulaSchema, recipeSchema, renderFormula, validateFormula } from "./bees.ts";

const CONFIG_ARGUMENT = 1;
const recipe = recipeSchema.parse({
	// eslint-disable-next-line unicorn/no-null -- Exercise the canonical execution directory.
	cwd: null,
	effort: "low",
	harness: "codex",
	kind: "worker",
	model: "model",
});
const formula = formulaSchema.parse({
	argv: [
		"{{#if system_prompt}}-c{{/if}}",
		"{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}",
		"{{prompt}}",
	],
	executable: "codex",
});
const role = 'Review "quotes", \\paths, <tags> and {{literal}}.\nKeep\ttabs and Unicode: 🐝';

// Warm schema/template execution outside unit-test timing.
validateFormula(formula);

test.each([
	{ prompt: "", system_prompt: "" },
	{ prompt: "Run direction", system_prompt: "" },
	{ prompt: "", system_prompt: role },
	{ prompt: "Run direction", system_prompt: role },
])("formulas separate optional role and execution arguments: %j", ({ prompt, system_prompt }) => {
	const current = { ...recipe, prompt, system_prompt };
	const rendered = renderFormula(formula, current, "interactive");
	const expected: string[] = [];
	if (system_prompt !== "") {
		expected.push("-c", `developer_instructions=${JSON.stringify(system_prompt)}`);
		// Codex -c accepts a TOML value; verify exact native string round-trip.
		expect(Bun.TOML.parse(rendered.argv.at(CONFIG_ARGUMENT)!)).toEqual({
			developer_instructions: system_prompt,
		});
	}
	if (prompt !== "") {
		expected.push(prompt);
	}
	expect(rendered.argv).toEqual(expected);
});

test("native string arguments retain role and direction verbatim", () => {
	expect(
		renderFormula(
			formulaSchema.parse({
				executable: "pi",
				argv: ["--append-system-prompt", "{{system_prompt}}", "{{prompt}}"],
			}),
			{ ...recipe, system_prompt: role, prompt: "Execution direction" },
			"interactive",
		).argv,
	).toEqual(["--append-system-prompt", role, "Execution direction"]);
});

test("omitted recipe prompts become independent empty defaults", () => {
	expect(recipe).toMatchObject({ prompt: "", system_prompt: "" });
});

test.each([
	{ mode: "interactive" as const, prefix: [] },
	{ mode: "headless" as const, prefix: ["exec", "--json", "low"] },
])("formula mode selects a rendered prefix before shared arguments: $mode", ({ mode, prefix }) => {
	const rendered = renderFormula(
		{ ...formula, headless: ["exec", "--json", "{{effort}}", "{{#if cwd}}--directory{{/if}}"] },
		{ ...recipe, prompt: role },
		mode,
	);
	expect(rendered).toEqual({ executable: "codex", argv: [...prefix, role] });
});

test("headless templates are validated before a formula is installed", () => {
	expect(() => validateFormula({ ...formula, headless: ["{{missing}}"] })).toThrow(Error);
});

test.each(["{{#unless system_prompt}}{{unknown}}{{/unless}}", "{{json unknown}}"])(
	"formula validation rejects missing values, including optional branches and helper arguments: %s",
	(token) => {
		expect(() =>
			validateFormula({
				executable: "codex",
				headless: [],
				argv: [token],
			}),
		).toThrow(Error);
	},
);
