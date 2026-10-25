import type { ParsedBvRecipes } from "../src/bv-recipes.ts";

const work =
	"  _hive_work:\n" +
	"    description: Ordinary work, excluding automation and workflow beads\n" +
	"    filters:\n      exclude_tags:\n        - system\n        - busybee-workflow\n";
const system =
	"  _hive_system:\n    description: Automation-owned records\n" +
	"    filters:\n      tags:\n        - system\n";
const workflows =
	"  _hive_workflows:\n    description: Busy Bee workflow work\n" +
	"    filters:\n      tags:\n        - busybee-workflow\n";
const opening = "  # beeswax:begin bv-recipes v1";
const closing = "  # beeswax:end bv-recipes";
const contents = `recipes:\n${opening}\n${work}${system}${workflows}${closing}\n`;
const INDENT = 2;

/** Independent current-recipe fixture; bv-recipe-source.test.ts verifies projection parity. */
export function managedRecipes(): ParsedBvRecipes {
	const end = contents.indexOf(closing);
	return {
		contents,
		data: {
			recipes: {
				_hive_work: {
					description: "Ordinary work, excluding automation and workflow beads",
					filters: { exclude_tags: ["system", "busybee-workflow"] },
				},
				_hive_system: {
					description: "Automation-owned records",
					filters: { tags: ["system"] },
				},
				_hive_workflows: {
					description: "Busy Bee workflow work",
					filters: { tags: ["busybee-workflow"] },
				},
			},
		},
		root: {
			flow: false,
			position: 0,
			indent: "",
			needsComma: false,
			commas: [],
			start: 0,
			finish: contents.length,
		},
		container: {
			kind: "map",
			keyStart: 0,
			layout: {
				flow: false,
				position: contents.indexOf(work),
				indent: "  ",
				needsComma: false,
				commas: [],
				start: "recipes:\n".length,
				finish: contents.length,
			},
		},
		members: [
			{ scope: "document", name: "recipes", start: 0, finish: end },
			...[
				{ name: "_hive_work", fragment: work },
				{ name: "_hive_system", fragment: system },
				{ name: "_hive_workflows", fragment: workflows },
			].map(({ name, fragment }) => ({
				scope: "recipes" as const,
				name,
				start: contents.indexOf(fragment) + INDENT,
				finish: contents.indexOf(fragment) + fragment.length,
			})),
		],
		markers: [opening, closing].map((text) => ({
			start: contents.indexOf(text),
			finish: contents.indexOf(text) + text.length,
			indent: "  ",
			text: text.trimStart(),
		})),
		references: [],
	};
}
