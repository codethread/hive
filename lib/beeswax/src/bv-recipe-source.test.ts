import { bvRecipeFiles, parseBvRecipeSource } from "./bv-recipe-source.ts";
import { expect, test } from "bun:test";
import { installBvRecipes, reconcileBvRecipes } from "./bv-recipes.ts";
import { managedRecipes } from "../tests/bv-recipe-fixture.ts";

const NEXT = 1;
const path = "/repo/.bv/recipes.yaml";

test("text-backed recipe adapter matches the managed fixture without rewriting", async () => {
	const expected = managedRecipes();
	const reads: string[] = [];
	const files = bvRecipeFiles({
		read: (selected) => {
			reads.push(selected);
			return Promise.resolve(expected.contents);
		},
		write: () => Promise.reject(new Error("Current recipes must not be rewritten")),
	});
	expect(
		await installBvRecipes(["/repo"], {
			async read(selected) {
				const parsed = await files.read(selected);
				expect(parsed).toEqual(expected);
				return parsed;
			},
			write: files.write,
		}),
	).toEqual([path]);
	expect(reads).toEqual([path]);
});

test("block recipe roundtrip preserves user bytes and is idempotent", () => {
	const user = "# personal\nnotes: |\n  # beeswax:begin bv-recipes v1\n";
	const personal = "  mine: { description: 'keep this', filters: { tags: [personal] } }\n";
	const contents = `${user}recipes:\n${personal}`;
	const parsed = parseBvRecipeSource(contents, path);
	expect(parsed.markers).toEqual([]);
	expect(parsed.members).toContainEqual({
		scope: "recipes",
		name: "mine",
		start: contents.indexOf("mine:"),
		finish: contents.lastIndexOf("}") + NEXT,
	});
	const after = reconcileBvRecipes(parsed, path);
	expect(after).toStartWith(`${user}recipes:\n`);
	expect(after).toContain(personal);
	expect(reconcileBvRecipes(parseBvRecipeSource(after, path), path)).toBe(after);
});

test("flow recipe roundtrip preserves alias bytes and resolved values", () => {
	const declaration = "defaults: &defaults { tags: [personal] }";
	const contents = `${declaration}\nrecipes: { mine: *defaults }\n`;
	const parsed = parseBvRecipeSource(contents, path);
	expect(parsed.container).toMatchObject({ kind: "map", layout: { flow: true } });
	expect(parsed.references).toEqual([
		{
			source: contents.indexOf("*defaults"),
			start: contents.indexOf("{ tags:"),
			includesRecipes: false,
		},
	]);
	const after = reconcileBvRecipes(parsed, path);
	expect(after).toStartWith(`${declaration}\n`);
	expect(after).toContain("mine: *defaults");
	expect(parseBvRecipeSource(after, path).data.recipes?.mine).toEqual({ tags: ["personal"] });
});
