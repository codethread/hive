import type { Formula, Recipe } from "./bees.ts";
import { expect, test } from "bun:test";
import { renderFormula, validateFormula } from "./bees.ts";

const HOME = "/users/test home";
const CONFIG_ARGUMENT = 1;
const recipe: Recipe = {
	// eslint-disable-next-line unicorn/no-null -- Use the canonical-directory recipe shape.
	cwd: null,
	effort: "low",
	harness: "codex",
	kind: "worker",
	model: "model",
	prompt: "",
	system_prompt: "",
};
const formula: Formula = {
	argv: [
		"{{#if system_prompt}}-c{{/if}}",
		"{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}",
		"{{prompt}}",
	],
	executable: "codex",
	headless: [],
};
const role = 'Review "quotes", \\paths, <tags> and {{literal}}.\nKeep\ttabs and Unicode: 🐝';

test.each([
	{ prompt: "", system_prompt: "" },
	{ prompt: "Run direction", system_prompt: "" },
	{ prompt: "", system_prompt: role },
	{ prompt: "Run direction", system_prompt: role },
])(
	"formulas separate optional role and execution arguments: %j #test-395",
	({ prompt, system_prompt }) => {
		const current = { ...recipe, prompt, system_prompt };
		const rendered = renderFormula(formula, current, "interactive", HOME);
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
	},
);

test("native string arguments retain role and direction verbatim #test-622", () => {
	expect(
		renderFormula(
			{
				executable: "pi",
				argv: ["--append-system-prompt", "{{system_prompt}}", "{{prompt}}"],
				headless: [],
			},
			{ ...recipe, system_prompt: role, prompt: "Execution direction" },
			"interactive",
			HOME,
		).argv,
	).toEqual(["--append-system-prompt", role, "Execution direction"]);
});

test.each([
	{ mode: "interactive" as const, prefix: [] },
	{ mode: "headless" as const, prefix: ["exec", "--json", "low"] },
])(
	"formula mode selects a rendered prefix before shared arguments: $mode #test-489",
	({ mode, prefix }) => {
		const rendered = renderFormula(
			{ ...formula, headless: ["exec", "--json", "{{effort}}", "{{#if cwd}}--directory{{/if}}"] },
			{ ...recipe, prompt: role },
			mode,
			HOME,
		);
		expect(rendered).toEqual({ executable: "codex", argv: [...prefix, role] });
	},
);

test("formula validation rejects missing values in headless templates #test-599", () => {
	expect(() => validateFormula({ ...formula, headless: ["{{missing}}"] })).toThrow(Error);
});

test.each(["{{#unless system_prompt}}{{unknown}}{{/unless}}", "{{json unknown}}"])(
	"formula validation rejects missing values, including optional branches and helper arguments: %s #test-530",
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

test.each(["interactive", "headless"] as const)(
	"home-relative executables resolve without expanding arguments: %s",
	(mode) => {
		const rendered = renderFormula(
			{ executable: "~/.pi/agent/bin/pi", argv: ["~/literal"], headless: [] },
			recipe,
			mode,
			HOME,
		);
		expect(rendered).toEqual({ executable: `${HOME}/.pi/agent/bin/pi`, argv: ["~/literal"] });
	},
);
