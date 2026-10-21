import type {
	BvRecipeFiles,
	ParsedBvRecipes,
	RecipeMapLayout,
	RecipeMember,
	RecipeReference,
} from "./bv-recipes.ts";
import { isMap, isScalar, parseDocument, visit } from "yaml";
import type { WorkspaceIO } from "./services.ts";
import type { YAMLMap } from "yaml";
import { bvRecipeAmbiguous } from "./bv-recipes.ts";
import { errorMessage } from "./errors.ts";
import { z } from "zod";

const FIRST = 0;
const SINGLE = 1;
const INDENT = 2;
const DOCUMENT_END = 2;
const documentSchema = z.looseObject({
	recipes: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Validated loose document shape; individual user recipes remain opaque. */
export type BvRecipeData = z.infer<typeof documentSchema>;

/** Adapt workspace text reads to parsed recipe inputs, passing writes through unchanged. */
export function bvRecipeFiles(io: Pick<WorkspaceIO, "read" | "write">): BvRecipeFiles {
	return {
		async read(path) {
			return parseBvRecipeSource(await io.read(path), path);
		},
		write: (path, contents) => io.write(path, contents),
	};
}

/** Parse YAML and validate its shape once, projecting source facts for ownership and edit decisions. */
// eslint-disable-next-line max-statements -- Project the one validated document into source-edit facts.
export function parseBvRecipeSource(contents: string, path: string): ParsedBvRecipes {
	if (contents === "") {
		return {
			contents,
			data: {},
			container: { kind: "absent" },
			members: [],
			markers: [],
			references: [],
			root: {
				flow: false,
				position: FIRST,
				indent: "",
				needsComma: false,
				commas: [],
				start: FIRST,
				finish: FIRST,
			},
		};
	}
	try {
		const document = parseDocument(contents, {
			uniqueKeys: true,
			stringKeys: true,
			merge: true,
			keepSourceTokens: true,
		});
		const problem = [...document.errors, ...document.warnings].at(FIRST);
		if (problem) {
			throw problem;
		}
		const root = document.contents;
		let value: unknown = document.toJS();
		if (value === null && (!root || root.range[FIRST] === root.range[SINGLE])) {
			value = {};
		}
		const data = documentSchema.parse(value);
		if (root && !isMap(root) && root.range[FIRST] !== root.range[SINGLE]) {
			throw new Error("The BV document must be a YAML mapping.");
		}
		let pair: YAMLMap.Parsed["items"][number] | undefined = undefined;
		if (isMap(root)) {
			pair = root.items.find(({ key }) => isScalar(key) && key.value === "recipes");
		}
		const members: RecipeMember[] = [];
		const scalars: [number, number][] = [];
		const references: RecipeReference[] = [];
		visit(document, {
			Scalar(_key, node) {
				scalars.push([node.range![FIRST], node.range![SINGLE]]);
			},
			Alias(_key, node) {
				const target = node.resolve(document)!;
				references.push({
					source: node.range![FIRST],
					start: target.range![FIRST],
					includesRecipes: target === pair?.value || target === root,
				});
			},
		});
		if (isMap(root)) {
			members.push(...mapMembers(root, "document"));
		}
		const markers = [
			...contents.matchAll(
				/^(?<indent>[ \t]*)#[ \t]*beeswax:[ \t]*(?:begin|end)[ \t]+bv-recipes[^\r\n]*/gmu,
			),
		]
			.filter(
				(match) => !scalars.some(([start, finish]) => match.index >= start && match.index < finish),
			)
			.map((match) => ({
				start: match.index,
				finish: match.index + match[FIRST].length,
				indent: match.groups!["indent"]!,
				text: match[FIRST].trimStart(),
			}));
		const documentFinish = document.range![DOCUMENT_END];
		let rootLayout: RecipeMapLayout = {
			flow: false,
			position: contents.length,
			indent: "",
			needsComma: false,
			commas: [],
			start: FIRST,
			finish: documentFinish,
		};
		if (isMap(root)) {
			rootLayout = mapLayout(contents, root, documentFinish);
		} else if (root) {
			rootLayout.position = lineEnd(contents, root.range[FIRST]);
		}
		let container: ParsedBvRecipes["container"] = { kind: "absent" };
		if (pair && isScalar(pair.key)) {
			const keyStart = pair.key.range![FIRST];
			const next = members.find((member) => member.scope === "document" && member.start > keyStart);
			const finish = next?.start ?? documentFinish;
			if (isMap(pair.value)) {
				members.push(...mapMembers(pair.value, "recipes"));
				const layout = mapLayout(contents, pair.value, finish);
				if (!layout.flow) {
					layout.start = lineEnd(contents, keyStart);
				}
				container = { kind: "map", keyStart, layout };
			} else if (
				isScalar(pair.value) &&
				pair.value.value === null &&
				pair.value.range![FIRST] === pair.value.range![SINGLE]
			) {
				container = {
					kind: "implicit",
					keyStart,
					layout: {
						flow: false,
						position: lineEnd(contents, keyStart),
						indent: " ".repeat(column(contents, keyStart) + INDENT),
						needsComma: false,
						commas: [],
						start: lineEnd(contents, keyStart),
						finish,
					},
				};
			} else {
				container = { kind: "indirect" };
			}
		} else if (Object.hasOwn(data, "recipes")) {
			container = { kind: "indirect" };
		}
		return { contents, data, root: rootLayout, container, members, markers, references };
	} catch (error) {
		throw bvRecipeAmbiguous(path, `Invalid or ambiguous YAML: ${errorMessage(error)}`);
	}
}

// --- Private functions ---

function mapMembers(map: YAMLMap.Parsed, scope: RecipeMember["scope"]): RecipeMember[] {
	return map.items.map(({ key, value }) => {
		let name = "<<";
		if (isScalar(key)) {
			name = String(key.value);
		}
		const finish = Math.max(key.range[SINGLE], value?.range[SINGLE] ?? FIRST);
		return { scope, name, start: key.range[FIRST], finish };
	});
}

function mapLayout(contents: string, map: YAMLMap.Parsed, finish: number): RecipeMapLayout {
	const token = map.srcToken!;
	if (token.type === "flow-collection") {
		const last = token.items.at(-SINGLE);
		const trailingComma =
			last && !last.key && !last.value && last.start.some(({ type }) => type === "comma");
		return {
			flow: true,
			position: map.range[SINGLE] - SINGLE,
			indent: " ".repeat(token.indent + INDENT),
			needsComma: map.items.length > FIRST && !trailingComma,
			commas: token.items.flatMap((item) =>
				item.start.filter(({ type }) => type === "comma").map(({ offset }) => offset),
			),
			start: map.range[FIRST] + SINGLE,
			finish: map.range[SINGLE] - SINGLE,
		};
	}
	return {
		flow: false,
		position: lineStart(contents, map.range[FIRST]),
		indent: " ".repeat(column(contents, map.range[FIRST])),
		needsComma: false,
		commas: [],
		start: FIRST,
		finish,
	};
}

function lineStart(contents: string, offset: number): number {
	return contents.lastIndexOf("\n", offset - SINGLE) + SINGLE;
}

function lineEnd(contents: string, offset: number): number {
	const position = contents.indexOf("\n", offset);
	if (position < FIRST) {
		return contents.length;
	}
	return position + SINGLE;
}

function column(contents: string, offset: number): number {
	return offset - lineStart(contents, offset);
}
