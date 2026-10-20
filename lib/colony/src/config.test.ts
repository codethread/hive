import { expect, test } from "bun:test";
import type { ConfigFiles } from "./config.ts";
import { loadBeesConfig } from "./config.ts";

const CENTRAL = "/repo/.hive/bees.toml";
const POLICY = 'owner="ct"\nhumans=["ct"]\n[formulas]\n';
const DEFINITION =
	'name="reviewer"\ndescription="Review changes."\nharness="codex"\nmodel="folder-model"\neffort="high"\n';
const INLINE =
	'[kinds.reviewer]\ndescription="Central ' +
	'reviewer."\nharness="pi"\nmodel="central-model"\neffort="low"\nprompt="Central ' +
	'instructions"\n';

// Warm the schema at fixture setup, outside unit-test timing.
await loadBeesConfig("/repo", fixture({ [CENTRAL]: POLICY }));

test("folder names do not name kinds, and sibling prompts are captured verbatim #test-413", async () => {
	const { config, warnings } = await loadBeesConfig(
		"/repo",
		fixture({
			[CENTRAL]: POLICY,
			"/repo/.hive/bees/arbitrary-folder/bee.toml": DEFINITION,
			"/repo/.hive/bees/arbitrary-folder/system_prompt.md": "# Review\n\nKeep this text.\n",
		}),
	);
	expect(config.kinds).toEqual({
		reviewer: {
			description: "Review changes.",
			effort: "high",
			harness: "codex",
			hidden: false,
			model: "folder-model",
			prompt: "",
			system_prompt: "# Review\n\nKeep this text.\n",
			workflow: "do-work",
		},
	});
	expect(warnings).toEqual([]);
});

test("central definitions replace whole duplicate kinds and report every shadowed file #test-541", async () => {
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
		system_prompt: "",
		workflow: "do-work",
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
	`${DEFINITION}prompt="Inline is forbidden"`,
	`${DEFINITION}system_prompt="Inline is forbidden"`,
	`${DEFINITION}prompt_file="other.md"`,
	`${DEFINITION}unknown=true`,
	"not valid TOML",
])("invalid folder input fails even when centrally shadowed: %j #test-479", async (definition) => {
	const contents: Record<string, string> = {
		[CENTRAL]: POLICY + INLINE,
		"/repo/.hive/bees/review/bee.toml": definition,
		"/repo/.hive/bees/review/prompt.md": "External",
	};
	await expect(loadBeesConfig("/repo", fixture(contents))).rejects.toBeInstanceOf(Error);
});

test("root bees.toml is not a fallback", async () => {
	await expect(
		loadBeesConfig("/repo", fixture({ "/repo/bees.toml": POLICY })),
	).rejects.toBeInstanceOf(Error);
});

test.each([
	{ prompt: undefined, system_prompt: undefined },
	{ prompt: "", system_prompt: "" },
	{ prompt: "Run direction\n", system_prompt: undefined },
	{ prompt: undefined, system_prompt: "Role protocol\n" },
	{ prompt: "Run direction\n", system_prompt: "Role protocol\n" },
])(
	"kind prompt files are independently optional: %j #test-480",
	async ({ prompt, system_prompt }) => {
		const contents: Record<string, string> = {
			[CENTRAL]: POLICY,
			"/repo/.hive/bees/review/bee.toml": DEFINITION,
		};
		if (prompt !== undefined) {
			contents["/repo/.hive/bees/review/prompt.md"] = prompt;
		}
		if (system_prompt !== undefined) {
			contents["/repo/.hive/bees/review/system_prompt.md"] = system_prompt;
		}
		const { config } = await loadBeesConfig("/repo", fixture(contents));
		expect(config.kinds["reviewer"]).toMatchObject({
			prompt: prompt ?? "",
			system_prompt: system_prompt ?? "",
		});
	},
);

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
				return Promise.reject(
					Object.assign(new Error(`Missing fixture ${path}`), { code: "ENOENT" }),
				);
			}
			return Promise.resolve(text);
		},
	};
}
