import { expect, test } from "bun:test";
import type { ConfigFiles } from "./config.ts";
import { loadBeesConfig } from "./config.ts";

const CENTRAL = "/repo/.hive/bees.toml";
const POLICY = 'owner="ct"\nhumans=["ct"]\n[formulas]\n';
const DEFINITION =
	'name="reviewer"\ndescription="Review changes."\nharness="codex"\nmodel="folder-model"\neffort="high"\n';
const INLINE =
	'[kinds.reviewer]\ndescription="Central reviewer."\nharness="pi"\nmodel="central-model"\neffort="low"\nprompt="Central instructions"\n';

// Warm the schema at fixture setup, outside unit-test timing.
await loadBeesConfig("/repo", fixture({ [CENTRAL]: POLICY }));

test("folder names do not name kinds, and sibling prompts are captured verbatim", async () => {
	const { config, warnings } = await loadBeesConfig(
		"/repo",
		fixture({
			[CENTRAL]: POLICY,
			"/repo/.hive/bees/arbitrary-folder/bee.toml": DEFINITION,
			"/repo/.hive/bees/arbitrary-folder/prompt.md": "# Review\n\nKeep this text.\n",
		}),
	);
	expect(config.kinds).toEqual({
		reviewer: {
			description: "Review changes.",
			effort: "high",
			harness: "codex",
			hidden: false,
			model: "folder-model",
			prompt: "# Review\n\nKeep this text.\n",
		},
	});
	expect(warnings).toEqual([]);
});

test("central definitions replace whole duplicate kinds and report every shadowed file", async () => {
	const { config, warnings } = await loadBeesConfig(
		"/repo",
		fixture({
			[CENTRAL]: POLICY + INLINE,
			"/repo/.hive/bees/a/bee.toml": DEFINITION,
			"/repo/.hive/bees/a/prompt.md": "A instructions",
			"/repo/.hive/bees/z/bee.toml": DEFINITION,
			"/repo/.hive/bees/z/prompt.md": "Z instructions",
		}),
	);
	expect(config.kinds["reviewer"]).toEqual({
		description: "Central reviewer.",
		effort: "low",
		harness: "pi",
		hidden: false,
		model: "central-model",
		prompt: "Central instructions",
	});
	expect(warnings).toEqual([
		`${CENTRAL} overrides bee kind reviewer from /repo/.hive/bees/a/bee.toml`,
		`${CENTRAL} overrides bee kind reviewer from /repo/.hive/bees/z/bee.toml`,
	]);
});

test("duplicate folder names for a kind fail without a central winner", async () => {
	await expect(
		loadBeesConfig(
			"/repo",
			fixture({
				[CENTRAL]: POLICY,
				"/repo/.hive/bees/a/bee.toml": DEFINITION,
				"/repo/.hive/bees/a/prompt.md": "A instructions",
				"/repo/.hive/bees/b/bee.toml": DEFINITION,
				"/repo/.hive/bees/b/prompt.md": "B instructions",
			}),
		),
	).rejects.toBeInstanceOf(Error);
});

test.each([
	{ definition: DEFINITION, prompt: undefined },
	{ definition: DEFINITION, prompt: "" },
	{ definition: `${DEFINITION}prompt="Inline is forbidden"`, prompt: "External" },
	{ definition: `${DEFINITION}prompt_file="other.md"`, prompt: "External" },
	{ definition: `${DEFINITION}unknown=true`, prompt: "External" },
	{ definition: "not valid TOML", prompt: "External" },
])(
	"invalid folder input fails even when centrally shadowed: %j",
	async ({ definition, prompt }) => {
		const contents: Record<string, string> = {
			[CENTRAL]: POLICY + INLINE,
			"/repo/.hive/bees/review/bee.toml": definition,
		};
		if (prompt !== undefined) {
			contents["/repo/.hive/bees/review/prompt.md"] = prompt;
		}
		await expect(loadBeesConfig("/repo", fixture(contents))).rejects.toBeInstanceOf(Error);
	},
);

test("root bees.toml is not a fallback", async () => {
	await expect(
		loadBeesConfig("/repo", fixture({ "/repo/bees.toml": POLICY })),
	).rejects.toBeInstanceOf(Error);
});

// --- Private functions ---
function fixture(contents: Record<string, string>): ConfigFiles {
	return {
		directories: (path) => {
			const prefix = `${path}/`;
			const folders = Object.keys(contents)
				.filter((file) => file.startsWith(prefix))
				.map((file) => file.slice(prefix.length, file.lastIndexOf("/")));
			return Promise.resolve([...new Set(folders)].toReversed());
		},
		readText: (path) => {
			const text = contents[path];
			if (text === undefined) {
				return Promise.reject(new Error(`Missing fixture ${path}`));
			}
			return Promise.resolve(text);
		},
	};
}
