import { BeeswaxError, errorMessage } from "./errors.ts";
import type { BvRecipeData } from "./bv-recipe-source.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Viewer configuration belongs to each validated checkout.
import { join } from "node:path";
import { stringify } from "yaml";

const FIRST = 0;
const SINGLE = 1;
const INDENT = 2;
const begin = "# beeswax:begin bv-recipes v1";
const end = "# beeswax:end bv-recipes";
const recipes = {
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
const blockBody = stringify(recipes).trimEnd();
const flowBody = Object.entries(recipes)
	.map(
		([name, recipe]) => `${name}: ${stringify(recipe, { flow: true, lineWidth: FIRST }).trimEnd()}`,
	)
	.join(",\n");
const blockSection = { flow: false, container: false, leadingComma: false, trailingComma: false };

export interface RecipeMapLayout {
	/** Whether this map uses flow-style braces. */
	flow: boolean;
	/** Insertion offset for a new managed section. */
	position: number;
	/** Indentation for managed entries and section markers. */
	indent: string;
	/** Whether an appended flow entry needs a leading comma. */
	needsComma: boolean;
	/** Offsets of this map's commas, excluding commas in nested values. */
	commas: number[];
	/** First source offset allowed for a managed section. */
	start: number;
	/** Exclusive source bound allowed for a managed section. */
	finish: number;
}

export interface RecipeMember {
	/** Map that directly contains this member. */
	scope: "document" | "recipes";
	/** Source key used to identify top-level or recipe ownership. */
	name: string;
	/** Offset at the member's key. */
	start: number;
	/** Exclusive end of the member's key and value. */
	finish: number;
}

export interface RecipeMarker {
	/** Offset at the marker line's start, including indentation. */
	start: number;
	/** Exclusive end of the marker comment, before its newline. */
	finish: number;
	/** Leading whitespace used to check and preserve section indentation. */
	indent: string;
	/** Comment without indentation; spelling and version await ownership checks. */
	text: string;
}

export interface RecipeReference {
	/** Offset of the alias use. */
	source: number;
	/** Start of the resolved target node, not its anchor declaration. */
	start: number;
	/** Whether the resolved target is the root or recipes container. */
	includesRecipes: boolean;
}

/** Validated values and source facts; all offsets index the original JavaScript string. */
export interface ParsedBvRecipes {
	/** Original text retained for exact prefix/suffix splicing. */
	contents: string;
	/** Validated document shape; user recipe values remain opaque. */
	data: BvRecipeData;
	/** Root map's insertion layout and section bounds. */
	root: RecipeMapLayout;
	/** Recipes source form; indirect values cannot be edited as a direct map. */
	container:
		| {
				/** Missing member or a value that is not a direct editable map. */
				kind: "absent" | "indirect";
		  }
		| {
				/** Direct mapping or implicit empty value after the recipes key. */
				kind: "map" | "implicit";
				/** Key offset used to determine whether the section owns the container. */
				keyStart: number;
				/** Layout and section bounds for recipe entries. */
				layout: RecipeMapLayout;
		  };
	/** Direct root and recipe members with their complete key/value extents. */
	members: RecipeMember[];
	/** Candidate BV marker lines outside scalar values, in source order. */
	markers: RecipeMarker[];
	/** Resolved alias uses and targets needed to protect unowned values. */
	references: RecipeReference[];
}

export interface BvRecipeFiles {
	/** Load validated values and source facts for one recipe file. */
	read: (path: string) => Promise<ParsedBvRecipes>;
	/** Write the reconciled source text. */
	write: (path: string, contents: string) => Promise<void>;
}

interface Section {
	/** String offset at the opening marker line. */
	start: number;
	/** Exclusive offset after the closing marker, leaving its newline outside the section. */
	finish: number;
	/** Shared marker indentation reused for generated definitions. */
	indent: string;
}

/** Plan all checkout edits before writing; retain confirmed paths if a later write fails. */
// eslint-disable-next-line max-statements -- Preflight all outputs and retain ordered confirmed effects.
export async function installBvRecipes(
	checkouts: string[],
	files: BvRecipeFiles,
): Promise<string[]> {
	const installed: string[] = [];
	try {
		const plans = await Promise.all(
			[...new Set(checkouts)].map(async (checkout) => {
				const path = join(checkout, ".bv/recipes.yaml");
				const before = await files.read(path);
				return { path, before: before.contents, after: reconcileBvRecipes(before, path) };
			}),
		);
		for (const { path, before, after } of plans) {
			if (before !== after) {
				// eslint-disable-next-line no-await-in-loop -- Retain each confirmed output before the next effect.
				await files.write(path, after);
			}
			installed.push(path);
		}
		return installed;
	} catch (error) {
		let reason = "bv_recipes_failed";
		let context: Record<string, unknown> = {};
		if (error instanceof BeeswaxError) {
			({ reason, context } = error);
		}
		throw new BeeswaxError(reason, errorMessage(error), {
			context: { ...context, bvRecipes: installed },
		});
	}
}

/** Reconcile validated values and source facts, rejecting ambiguous ownership and preserving unowned text. */
// eslint-disable-next-line max-statements -- Keep ownership validation and byte-preserving edits together.
export function reconcileBvRecipes(input: ParsedBvRecipes, path: string): string {
	const { contents, data, container } = input;
	const section = findSection(input, path);
	const direct = container.kind === "map" || container.kind === "implicit";
	const ownsContainer = Boolean(section && direct && inside(container.keyStart, section));
	for (const name of Object.keys(recipes)) {
		if (data.recipes && Object.hasOwn(data.recipes, name)) {
			const member = input.members.find(
				(entry) => entry.scope === "recipes" && entry.name === name,
			);
			if (!section || !member || !inside(member.start, section)) {
				throw bvRecipeAmbiguous(path, `Unmarked required recipe ${name}.`);
			}
		}
	}
	if (container.kind === "indirect") {
		throw bvRecipeAmbiguous(path, "The recipes value is not a direct YAML mapping.");
	}
	let newline = "\n";
	if (contents.includes("\r\n")) {
		newline = "\r\n";
	}
	if (section && !direct) {
		throw bvRecipeAmbiguous(path, "The section is outside the recipes mapping.");
	}
	let layout = input.root;
	if (direct && !ownsContainer) {
		({ layout } = container);
	}
	let after = "";
	if (section) {
		assertFootprint(input, { section, ownsContainer, layout }, path);
		let scope: RecipeMember["scope"] = "recipes";
		if (ownsContainer) {
			scope = "document";
		}
		const members = input.members.filter((member) => member.scope === scope);
		const replacement = renderSection(section.indent, newline, {
			flow: layout.flow,
			container: ownsContainer,
			...sectionCommas(members, section, layout),
		});
		after = contents.slice(FIRST, section.start) + replacement + contents.slice(section.finish);
	} else {
		let { indent } = layout;
		if (!direct && !layout.flow) {
			indent += " ".repeat(INDENT);
		}
		let addition = renderSection(indent, newline, {
			flow: layout.flow,
			container: !direct && layout.flow,
			leadingComma: layout.flow && layout.needsComma,
			trailingComma: false,
		});
		if (!direct && !layout.flow) {
			addition = `${layout.indent}recipes:${newline}${addition}`;
		}
		addition += newline;
		if (layout.flow) {
			addition += indent;
		}
		after = insertAt(contents, { position: layout.position, addition, newline });
	}
	if (after !== contents) {
		assertReferences(input, section, path);
	}
	return after;
}

/** Build the ownership-resolution diagnostic shared by parsing and reconciliation. */
export function bvRecipeAmbiguous(path: string, observed: string): BeeswaxError {
	return new BeeswaxError("bv_recipes_ambiguous", `${path}: ${observed}`, {
		context: {
			path,
			observed,
			desired: Object.keys(recipes),
			nextCommand: "beeswax migrate setup",
			guidance: "beeswax skills file repository-setup references/setup-migration.md",
			requiresUser: true,
		},
	});
}

// --- Private functions ---

function findSection(input: ParsedBvRecipes, path: string): Section | undefined {
	const { markers } = input;
	if (markers.length === FIRST) {
		return undefined;
	}
	const [opening, closing] = markers;
	if (
		markers.length !== INDENT ||
		opening?.text !== begin ||
		closing?.text !== end ||
		opening.indent !== closing.indent ||
		opening.indent.includes("\t")
	) {
		throw bvRecipeAmbiguous(path, "Expected one complete versioned Beeswax BV recipe section.");
	}
	return {
		start: opening.start,
		finish: closing.finish,
		indent: opening.indent,
	};
}

function assertFootprint(
	input: ParsedBvRecipes,
	{
		section,
		ownsContainer,
		layout,
	}: { section: Section; ownsContainer: boolean; layout: RecipeMapLayout },
	path: string,
): void {
	if (
		section.start < layout.start ||
		section.finish > layout.finish ||
		(!layout.flow && section.indent !== layout.indent)
	) {
		throw bvRecipeAmbiguous(path, "The section crosses the recipes mapping boundary.");
	}
	const affected = input.members.filter(
		(member) =>
			!(member.scope === "document" && member.name === "recipes" && !ownsContainer) &&
			member.start < section.finish &&
			member.finish > section.start,
	);
	for (const member of affected) {
		let owned = member.name === "recipes";
		if (member.scope === "recipes") {
			owned = Object.hasOwn(recipes, member.name);
		}
		if (!owned || member.start < section.start || member.finish > section.finish) {
			throw bvRecipeAmbiguous(path, "The section does not isolate whole managed recipe entries.");
		}
	}
}

function sectionCommas(members: RecipeMember[], section: Section, layout: RecipeMapLayout) {
	const before = members.filter((member) => member.finish <= section.start).at(-SINGLE);
	const after = members.find((member) => member.start >= section.finish);
	return {
		leadingComma: Boolean(
			layout.flow &&
			before &&
			!layout.commas.some((offset) => offset >= before.finish && offset < section.start),
		),
		trailingComma: Boolean(
			layout.flow &&
			after &&
			!layout.commas.some((offset) => offset >= section.finish && offset < after.start),
		),
	};
}

function assertReferences(
	input: ParsedBvRecipes,
	section: Section | undefined,
	path: string,
): void {
	const unchangedValues = Object.entries(recipes).every(([name, recipe]) =>
		Bun.deepEquals(input.data.recipes?.[name], recipe),
	);
	for (const reference of input.references) {
		const sourceReplaced = section && inside(reference.source, section);
		const targetReplaced = section && inside(reference.start, section);
		if (!sourceReplaced && (targetReplaced || (reference.includesRecipes && !unchangedValues))) {
			throw bvRecipeAmbiguous(path, "The managed edit would change an unowned alias or merge.");
		}
	}
}

// eslint-disable-next-line max-statements -- Render only the owned fence and YAML entries.
function renderSection(indent: string, newline: string, options = blockSection): string {
	let body = blockBody;
	if (options.flow) {
		body = flowBody;
	}
	if (options.container) {
		let container = `recipes: { ${body} }`;
		if (!options.flow) {
			container = `recipes:\n${body
				.split("\n")
				.map((line) => " ".repeat(INDENT) + line)
				.join("\n")}`;
		}
		body = container;
	}
	if (options.leadingComma) {
		body = `, ${body}`;
	}
	if (options.trailingComma) {
		body += ",";
	}
	const lines = body.split(/\r?\n/u).map((line) => indent + line);
	return [indent + begin, ...lines, indent + end].join(newline);
}

function insertAt(
	contents: string,
	{ position, addition, newline }: { position: number; addition: string; newline: string },
): string {
	let prefix = contents.slice(FIRST, position);
	if (prefix !== "" && !prefix.endsWith("\n")) {
		prefix += newline;
	}
	return prefix + addition + contents.slice(position);
}

function inside(offset: number, section: Section): boolean {
	return offset >= section.start && offset < section.finish;
}
