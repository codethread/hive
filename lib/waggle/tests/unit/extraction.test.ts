import { expect, test } from "bun:test";
import { SCOPES } from "../../eval/tautological-tests/scopes.ts";
import { assembleEvidence } from "../../eval/tautological-tests/extraction.ts";

const SELECTED_LINE = 8;
const file = {
	path: "example.test.ts",
	text: [
		"// 🐝 preserve offsets after astral Unicode",
		'import { test as check, describe, beforeEach, afterAll } from "bun:test";',
		'import * as suite from "bun:test";',
		"const rows = [[1, 2]]; let actual = 0;",
		'describe("outer", () => {',
		"  beforeEach(() => { actual = production(); });",
		'  describe("inner", () => {',
		'    check.each(rows)("row %s", (input, expected) => { expect(actual).toBe(expected); });',
		// eslint-disable-next-line no-template-curly-in-string -- Preserve the unevaluated title expression.
		"    suite.it.skipIf(flag)(`dynamic ${name}`, () => observe(actual));",
		"  });",
		"  afterAll(() => verifySharedObservations());",
		"});",
		'suite.test.todo("future");',
		'other.test("unrelated", () => {});',
	].join("\n"),
};

test.each([...SCOPES])("retains selected context and supplied evidence at scope %s", (scope) => {
	const selected = {
		start: file.text.indexOf("check.each"),
		end: file.text.indexOf(";", file.text.indexOf("check.each")),
		line: SELECTED_LINE,
		title: "row %s",
		suites: ["outer", "inner"],
		reducedScopeSupported: true,
		contexts: {
			1: {
				ranges: [],
				omitted: ["helper"],
				text: "beforeEach(() => { actual = production(); });",
			},
			2: { ranges: [], omitted: [], text: file.text },
			3: { ranges: [], omitted: [], text: file.text },
		},
		code: 'check.each(rows)("row %s", (input, expected) => { expect(actual).toBe(expected); })',
	};
	const input = assembleEvidence(file, selected, {
		scope,
		sources: [{ path: "production.ts", text: "export function production() { return 2; }" }],
		context: [{ path: "helpers.ts", text: "function observe(value) { expect(value).toBe(2); }" }],
		contract: undefined,
		automatic: undefined,
	});
	expect(input.test).toContain(selected.code);
	expect(input.context).toContain(selected.contexts[scope].text);
	expect(input.context).toContain("helpers.ts\nfunction observe");
	expect(input.source).toContain("production.ts\nexport function production");
	expect(input.contract).toContain("Unknown:");
});
