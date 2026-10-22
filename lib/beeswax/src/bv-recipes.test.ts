/* eslint-disable require-await -- In-memory file adapters preserve the asynchronous boundary. */
import type { ParsedBvRecipes, RecipeMember } from "./bv-recipes.ts";
import { expect, test } from "bun:test";
import { installBvRecipes, reconcileBvRecipes } from "./bv-recipes.ts";
import { BeeswaxError } from "./errors.ts";

const FIRST = 0;
const SINGLE = 1;
const PAIR = 2;
const path = "/repo/.bv/recipes.yaml";
const opening = "  # beeswax:begin bv-recipes v1";
const closing = "  # beeswax:end bv-recipes";
const work = [
	"  _hive_work:",
	"    description: Ordinary work, excluding automation and workflow beads",
	"    filters:",
	"      exclude_tags:",
	"        - system",
	"        - busybee-workflow",
	"",
].join("\n");
const system = [
	"  _hive_system:",
	"    description: Automation-owned records",
	"    filters:",
	"      tags:",
	"        - system",
	"",
].join("\n");
const workflows = [
	"  _hive_workflows:",
	"    description: Busy Bee workflow work",
	"    filters:",
	"      tags:",
	"        - busybee-workflow",
	"",
].join("\n");
const managedSection = `${opening}\n${work}${system}${workflows}${closing}`;
const managed = `recipes:\n${managedSection}\n`;
const required = {
	_hive_work: {
		description: "Ordinary work, excluding automation and workflow beads",
		filters: { exclude_tags: ["system", "busybee-workflow"] },
	},
	_hive_system: { description: "Automation-owned records", filters: { tags: ["system"] } },
	_hive_workflows: {
		description: "Busy Bee workflow work",
		filters: { tags: ["busybee-workflow"] },
	},
};

const requiredData = { recipes: required };

function source(contents: string, data: ParsedBvRecipes["data"] = {}): ParsedBvRecipes {
	return {
		contents,
		data,
		root: {
			flow: false,
			position: 0,
			indent: "",
			needsComma: false,
			commas: [],
			start: 0,
			finish: contents.length,
		},
		container: { kind: "absent" },
		members: [],
		markers: [],
		references: [],
	};
}

function member(
	contents: string,
	{ scope, name }: Pick<RecipeMember, "scope" | "name">,
	fragment: string,
): RecipeMember {
	const start = contents.indexOf(fragment);
	return { scope, name, start, finish: start + fragment.trimEnd().length };
}

function block(contents: string, data: ParsedBvRecipes["data"], position: number): ParsedBvRecipes {
	const input = source(contents, data);
	const keyStart = contents.indexOf("recipes:");
	input.container = {
		kind: "map",
		keyStart,
		layout: {
			flow: false,
			position,
			indent: "  ",
			needsComma: false,
			commas: [],
			start: contents.indexOf("\n", keyStart) + SINGLE,
			finish: contents.length,
		},
	};
	input.members.push(
		member(contents, { scope: "document", name: "recipes" }, contents.slice(keyStart)),
	);
	return input;
}

function fenced(
	contents = managed,
	data: ParsedBvRecipes["data"] = requiredData,
	entries = [
		{ name: "_hive_work", fragment: work },
		{ name: "_hive_system", fragment: system },
		{ name: "_hive_workflows", fragment: workflows },
	],
): ParsedBvRecipes {
	const input = block(contents, data, contents.indexOf(entries[FIRST]?.fragment ?? closing));
	input.markers = [opening, closing].map((text) => ({
		start: contents.indexOf(text),
		finish: contents.indexOf(text) + text.length,
		indent: "  ",
		text: text.trimStart(),
	}));
	for (const entry of entries) {
		input.members.push(member(contents, { scope: "recipes", name: entry.name }, entry.fragment));
	}
	return input;
}

test("reconciliation preserves every user byte and generic actionable/status policy", () => {
	const header = "# my viewer policy\r\nrecipes:\r\n  # Work is intentionally actionable\r\n";
	const personalWork =
		"  work:\r\n    description: 'My work' # exact quotes\r\n" +
		"    filters: {actionable: true, status: [open, in_progress]}\r\n";
	const personalSystem = "  system: {filters: {tags: [mine]}}\r\n";
	const personalWorkflows = "  workflows: {filters: {status: [blocked]}}\r\n";
	const tail = "# trailing comment\r\nother: [untouched, 'quoted']\r\n";
	const contents = header + personalWork + personalSystem + personalWorkflows + tail;
	const input = block(
		contents,
		{
			recipes: {
				work: {
					description: "My work",
					filters: { actionable: true, status: ["open", "in_progress"] },
				},
				system: { filters: { tags: ["mine"] } },
				workflows: { filters: { status: ["blocked"] } },
			},
			other: ["untouched", "quoted"],
		},
		header.length,
	);
	input.members = [
		member(
			contents,
			{ scope: "document", name: "recipes" },
			`recipes:\r\n${contents.slice("# my viewer policy\r\nrecipes:\r\n".length, -tail.length)}`,
		),
		member(contents, { scope: "document", name: "other" }, "other: [untouched, 'quoted']"),
		member(contents, { scope: "recipes", name: "work" }, personalWork),
		member(contents, { scope: "recipes", name: "system" }, personalSystem),
		member(contents, { scope: "recipes", name: "workflows" }, personalWorkflows),
	];
	expect(reconcileBvRecipes(input, path)).toBe(
		[
			header,
			`${managedSection.replaceAll("\n", "\r\n")}\r\n`,
			personalWork,
			personalSystem,
			personalWorkflows,
			tail,
		].join(""),
	);
});

test.each([
	{ contents: "", data: {}, position: 0, indent: "", expected: managed },
	{
		contents: "# comment only",
		data: {},
		position: "# comment only".length,
		indent: "",
		expected: `# comment only\n${managed}`,
	},
	{
		contents: "---\nother: 1\n...\n# after document\n",
		data: { other: 1 },
		position: "---\n".length,
		indent: "",
		expected: `---\n${managed}other: 1\n...\n# after document\n`,
	},
	{
		contents: "  other: 1\n",
		data: { other: 1 },
		position: 0,
		indent: "  ",
		expected: `${managed
			.split("\n")
			.filter(Boolean)
			.map((line) => `  ${line}\n`)
			.join("")}  other: 1\n`,
	},
])(
	"creates a recipe container at the source insertion point: $contents",
	({ contents, data, position, indent, expected }) => {
		const input = source(contents, data);
		input.root = { ...input.root, position, indent };
		expect(reconcileBvRecipes(input, path)).toBe(expected);
	},
);

// eslint-disable-next-line unicorn/no-null -- YAML implicit and explicit null have different edit authority.
const emptyRecipes = { recipes: null };

test("implicit empty recipes are editable but explicit null or indirect containers are not", () => {
	const contents = "recipes:\n  # add views here\n";
	const input = block(contents, emptyRecipes, "recipes:\n".length);
	if (input.container.kind === "map") {
		input.container = { ...input.container, kind: "implicit" };
	}
	expect(reconcileBvRecipes(input, path)).toBe(`${managed}  # add views here\n`);
	const indirect = source("recipes: null\n", emptyRecipes);
	indirect.container = { kind: "indirect" };
	expect(() => reconcileBvRecipes(indirect, path)).toThrow(BeeswaxError);
});

test.each([
	{
		contents: "recipes: {}\n",
		position: "recipes: {".length,
		needsComma: false,
		commas: [],
		suffix: "  }\n",
	},
	{
		contents: "recipes: { work: {}, }\n",
		data: { recipes: { work: {} } },
		position: "recipes: { work: {}, ".length,
		needsComma: false,
		commas: [],
		suffix: "  }\n",
	},
	{
		contents: "recipes: { work: {} # trailing comment\n}\n",
		data: { recipes: { work: {} } },
		position: "recipes: { work: {} # trailing comment\n".length,
		needsComma: true,
		commas: [],
		suffix: "  }\n",
	},
])(
	"inserts flow entries with source-local separators and comments: $contents",
	({ contents, data, position, needsComma, suffix }) => {
		const input = source(contents, data);
		input.container = {
			kind: "map",
			keyStart: 0,
			layout: {
				flow: true,
				position,
				indent: "  ",
				needsComma,
				commas: [],
				start: "recipes: {".length,
				finish: position,
			},
		};
		const result = reconcileBvRecipes(input, path);
		expect(result.startsWith(contents.slice(FIRST, position).trimEnd())).toBe(true);
		let expectedStart = "  _hive_work: {";
		if (needsComma) {
			expectedStart = "  , _hive_work: {";
		}
		expect(result).toContain(expectedStart);
		expect(result).toContain(
			"  _hive_system: { description: Automation-owned records, filters: { tags: [ system ] } }",
		);
		expect(result.endsWith(suffix)).toBe(true);
	},
);

test("a flow root gains only the managed recipe container", () => {
	const input = source("{ other: 'mine' }\n", { other: "mine" });
	input.root = {
		flow: true,
		position: "{ other: 'mine' ".length,
		indent: "  ",
		needsComma: true,
		commas: [],
		start: 1,
		finish: "{ other: 'mine' ".length,
	};
	const result = reconcileBvRecipes(input, path);
	expect(result).toStartWith(
		"{ other: 'mine' \n  # beeswax:begin bv-recipes v1\n  , recipes: { _hive_work:",
	);
	expect(result).toEndWith("  # beeswax:end bv-recipes\n  }\n");
});

test("known managed definitions are enforced without changing surrounding user bytes", () => {
	const contents = `${managed.replace("- busybee-workflow", "- wrong")}  work: {}\n`;
	const editedWork = work.replace("- busybee-workflow", "- wrong");
	const input = fenced(
		contents,
		{
			recipes: {
				...required,
				_hive_work: {
					...required["_hive_work"],
					filters: { exclude_tags: ["system", "wrong"] },
				},
				work: {},
			},
		},
		[
			{ name: "_hive_work", fragment: editedWork },
			{ name: "_hive_system", fragment: system },
			{ name: "_hive_workflows", fragment: workflows },
		],
	);
	input.members.push(member(contents, { scope: "recipes", name: "work" }, "  work: {}"));
	expect(reconcileBvRecipes(input, path)).toBe(`${managed}  work: {}\n`);
});

test("flow replacement keeps separators outside the fence and restores the separator before a user entry", () => {
	const before = "recipes: { work: {},\n";
	const after = "\n  custom: {}\n}\n";
	const contents = `${before}${opening}\n  _hive_work: {}, # comment after the comma\n${closing}${after}`;
	const input = fenced(contents, { recipes: { work: {}, _hive_work: {}, custom: {} } }, [
		{ name: "_hive_work", fragment: "  _hive_work: {}" },
	]);
	input.container = {
		kind: "map",
		keyStart: FIRST,
		layout: {
			flow: true,
			position: contents.lastIndexOf("}"),
			indent: "  ",
			needsComma: true,
			commas: [before.indexOf(","), contents.indexOf(", # comment")],
			start: "recipes: {".length,
			finish: contents.lastIndexOf("}"),
		},
	};
	input.members.push(
		member(contents, { scope: "recipes", name: "work" }, "work: {}"),
		member(contents, { scope: "recipes", name: "custom" }, "  custom: {}"),
	);
	const result = reconcileBvRecipes(input, path);
	expect(result).toStartWith(`${before}${opening}\n  _hive_work: {`);
	expect(result).toContain(`tags: [ busybee-workflow ] } },\n${closing}`);
	expect(result).toEndWith(`${closing}${after}`);
});

test("a removed managed recipe is recreated", () => {
	const input = fenced(
		managed.replace(system, ""),
		{
			recipes: { _hive_work: required["_hive_work"], _hive_workflows: required["_hive_workflows"] },
		},
		[
			{ name: "_hive_work", fragment: work },
			{ name: "_hive_workflows", fragment: workflows },
		],
	);
	expect(reconcileBvRecipes(input, path)).toBe(managed);
});

test.each(Object.entries(required).map(([name, value]) => ({ name, value })))(
	"refuses an unmarked required-name collision even when equal: $name",
	({ name, value }) => {
		const entry = { _hive_work: work, _hive_system: system, _hive_workflows: workflows }[name]!;
		const contents = `recipes:\n${entry}`;
		const input = block(contents, { recipes: { [name]: value } }, "recipes:\n".length);
		input.members.push(member(contents, { scope: "recipes", name }, entry));
		expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
	},
);

test("inherited required names are ownership collisions, not editable direct entries", () => {
	const contents = "defaults: &defaults {_hive_work: {}}\nrecipes: {<<: *defaults}\n";
	const input = source(contents, { defaults: { _hive_work: {} }, recipes: { _hive_work: {} } });
	input.container = {
		kind: "map",
		keyStart: contents.indexOf("recipes:"),
		layout: {
			flow: true,
			position: contents.lastIndexOf("}"),
			indent: "  ",
			needsComma: true,
			commas: [],
			start: contents.indexOf("{<<:") + SINGLE,
			finish: contents.lastIndexOf("}"),
		},
	};
	expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
});

test.each([
	{ openingText: "# beeswax:begin bv-recipes v1", closingText: "" },
	{ openingText: "", closingText: "# beeswax:end bv-recipes" },
	{ openingText: "#beeswax:begin  bv-recipes v1", closingText: "# beeswax:end bv-recipes" },
	{ openingText: "# beeswax:begin bv-recipes v2", closingText: "# beeswax:end bv-recipes" },
])(
	"refuses unfamiliar or incomplete ownership fences: $openingText / $closingText",
	({ openingText, closingText }) => {
		const input = source(`${openingText}\n${closingText}\nrecipes: {}\n`);
		input.markers = [openingText, closingText].filter(Boolean).map((text) => ({
			text,
			indent: "",
			start: input.contents.indexOf(text),
			finish: input.contents.indexOf(text) + text.length,
		}));
		expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
	},
);

test("duplicate or misaligned fences cannot establish ownership", () => {
	const pair = `${opening}\n${closing}\n`;
	const duplicate = fenced(`recipes:\n${pair}${pair}`, emptyRecipes, []);
	const secondPairStart = "recipes:\n".length + pair.length;
	duplicate.markers.push(
		...duplicate.markers.map((marker) => ({
			...marker,
			start: marker.start + pair.length,
			finish: marker.finish + pair.length,
		})),
	);
	expect(duplicate.markers[PAIR]!.start).toBe(secondPairStart);
	expect(() => reconcileBvRecipes(duplicate, path)).toThrow(BeeswaxError);
	const misalignedText = managed.replace(closing, closing.trimStart());
	const misaligned = fenced(misalignedText);
	misaligned.markers[SINGLE] = {
		text: closing.trimStart(),
		indent: "",
		start: misalignedText.indexOf(closing.trimStart()),
		finish: misalignedText.indexOf(closing.trimStart()) + closing.trimStart().length,
	};
	expect(() => reconcileBvRecipes(misaligned, path)).toThrow(BeeswaxError);
});

test("a section cannot capture an unowned recipe", () => {
	const contents = `recipes:\n${opening}\n  mine: {}\n${closing}\n`;
	const input = fenced(contents, { recipes: { mine: {} } }, []);
	input.members.push(member(contents, { scope: "recipes", name: "mine" }, "  mine: {}"));
	expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
});

test("a fence cannot cut through a managed value", () => {
	const fragment = `  _hive_work:\n    description: mine\n${closing}\n    filters: {}\n`;
	const contents = `recipes:\n${opening}\n${fragment}`;
	const input = fenced(
		contents,
		{ recipes: { _hive_work: { description: "mine", filters: {} } } },
		[{ name: "_hive_work", fragment }],
	);
	expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
});

test("scalar fence-lookalikes and unrelated aliases preserve user content", () => {
	const note = "note: |\n  # beeswax:begin bv-recipes v42\n  # beeswax:end bv-recipes\n";
	const aliases = "  first: &custom {}\n  second: *custom\n";
	const input = block(
		`recipes:\n${aliases}${note}`,
		{
			recipes: { first: {}, second: {} },
			note: "# beeswax:begin bv-recipes v42\n# beeswax:end bv-recipes\n",
		},
		"recipes:\n".length,
	);
	input.references = [
		{
			source: input.contents.indexOf("*custom"),
			start: input.contents.indexOf("{}"),
			includesRecipes: false,
		},
	];
	expect(reconcileBvRecipes(input, path)).toBe(managed + aliases + note);
});

test("aliases or merges outside the edit may not observe changed recipe values or deleted anchors", () => {
	const contents = "recipes: &v {}\nalias: *v\n";
	const input = block(contents, { recipes: {}, alias: {} }, "recipes: &v {".length);
	input.references = [
		{
			source: contents.indexOf("*v"),
			start: contents.indexOf("{}"),
			includesRecipes: true,
		},
	];
	expect(() => reconcileBvRecipes(input, path)).toThrow(BeeswaxError);
	const anchoredWork = work.replace("_hive_work:\n", "_hive_work: &managed\n");
	const contentsWithAnchor = `${managed.replace(work, anchoredWork)}alias: *managed\n`;
	const fencedInput = fenced(
		contentsWithAnchor,
		{
			recipes: required,
			alias: required["_hive_work"],
		},
		[
			{ name: "_hive_work", fragment: anchoredWork },
			{ name: "_hive_system", fragment: system },
			{ name: "_hive_workflows", fragment: workflows },
		],
	);
	fencedInput.references = [
		{
			source: contentsWithAnchor.indexOf("*managed"),
			start: contentsWithAnchor.indexOf("description:"),
			includesRecipes: false,
		},
	];
	expect(() => reconcileBvRecipes(fencedInput, path)).toThrow(BeeswaxError);
});

test.each([{ loadFailure: false }, { loadFailure: true }])(
	"all files are preflighted before writes, including later load failure: $loadFailure",
	async ({ loadFailure }) => {
		const writes: string[] = [];
		const conflict = block(
			"recipes:\n  _hive_work: {}\n",
			{ recipes: { _hive_work: {} } },
			"recipes:\n".length,
		);
		const failure = await installBvRecipes(["/repo", "/tracker"], {
			read: async (selected) => {
				if (selected.startsWith("/tracker")) {
					if (loadFailure) {
						throw new Error("read failed");
					}
					return conflict;
				}
				return source("");
			},
			write: async (selected) => {
				writes.push(selected);
			},
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({ context: { bvRecipes: [] } });
		expect(writes).toEqual([]);
	},
);

test("partial I/O failure reports only confirmed files and deduplicates selected checkouts", async () => {
	const files = new Map<string, string>();
	const failure = await installBvRecipes(["/repo", "/repo", "/tracker"], {
		read: async () => source(""),
		write: async (selected, contents) => {
			if (selected.startsWith("/tracker/")) {
				throw new Error("write failed");
			}
			files.set(selected, contents);
		},
	}).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({ reason: "bv_recipes_failed", context: { bvRecipes: [path] } });
	expect([...files.keys()]).toEqual([path]);
});

test("unchanged user-bearing artifacts are confirmed without redundant writes", async () => {
	const writes: string[] = [];
	const input = fenced(`${managed}  work: {}\n`, { recipes: { ...required, work: {} } });
	input.members.push(member(input.contents, { scope: "recipes", name: "work" }, "  work: {}"));
	const result = await installBvRecipes(["/repo", "/repo"], {
		read: async () => input,
		write: async (selected) => {
			writes.push(selected);
		},
	});
	expect(result).toEqual([path]);
	expect(writes).toEqual([]);
});
