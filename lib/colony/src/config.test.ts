import type { BeeKind, BeesConfig } from "@hive/shared";
import { expect, test } from "bun:test";
import { loadBeesConfig, resolveBeesConfig } from "./config.ts";
import type { ConfigFiles } from "./config.ts";

const CENTRAL = "/repo/.hive/bees.toml";
const POLICY = 'owner="ct"\nhumans=["ct"]\n[formulas]\n';
const DEFINITION =
	'name="reviewer"\ndescription="Review changes."\nharness="codex"\nmodel="folder-model"\neffort="high"\n';
const INLINE =
	'[kinds.reviewer]\ndescription="Central ' +
	'reviewer."\nharness="pi"\nmodel="central-model"\neffort="low"\nprompt="Central ' +
	'instructions"\n';

const typedKind: BeeKind = {
	description: "Review changes.",
	effort: "high",
	harness: "codex",
	hidden: false,
	model: "folder-model",
	prompt: "",
	system_prompt: "",
	workflow: "do-work",
};
const typedConfig: BeesConfig = {
	formulas: {},
	humans: ["ct"],
	kinds: {},
	limits: { colony: 1, kind: 1, kinds: {}, worktree: 1 },
	max_retries: 0,
	owner: "ct",
	ranking: "fifo",
	retry_delay_ms: 0,
};

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

test("central kinds replace whole folder definitions and warn in source order #test-541", () => {
	const central: BeesConfig = {
		...typedConfig,
		kinds: {
			reviewer: {
				...typedKind,
				description: "Central reviewer.",
				effort: "low",
				harness: "pi",
				model: "central-model",
				prompt: "Central instructions",
			},
		},
	};
	const { config, warnings } = resolveBeesConfig({ config: central, source: CENTRAL }, [
		{
			name: "reviewer",
			kind: {
				...typedKind,
				allow: ["discarded-selector"],
				hidden: true,
				prompt: "A instructions",
				system_prompt: "A role",
				workflow: "folder-workflow",
			},
			source: "/repo/.hive/bees/a/bee.toml",
		},
		{
			name: "reviewer",
			kind: { ...typedKind, prompt: "Z instructions", system_prompt: "Z role" },
			source: "/repo/.hive/bees/z/bee.toml",
		},
	]);
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

test("duplicate declared kind names fail without a central winner #test-615", () => {
	const resolve = () =>
		resolveBeesConfig({ config: typedConfig, source: CENTRAL }, [
			{ name: "reviewer", kind: typedKind, source: "/repo/.hive/bees/a/bee.toml" },
			{ name: "reviewer", kind: typedKind, source: "/repo/.hive/bees/b/bee.toml" },
		]);
	expect(resolve).toThrow(Error);
	expect(resolve).toThrowErrorMatchingInlineSnapshot(
		`"Duplicate bee kind reviewer: /repo/.hive/bees/a/bee.toml and /repo/.hive/bees/b/bee.toml"`,
	);
});

test("merged kinds satisfy central selectors without mutating central configuration", () => {
	const caller = { ...typedKind, allow: ["helper"] };
	const central: BeesConfig = { ...typedConfig, kinds: { caller } };
	const result = resolveBeesConfig({ config: central, source: CENTRAL }, [
		{ name: "helper", kind: typedKind, source: "/repo/.hive/bees/helper/bee.toml" },
	]);
	expect(result).toEqual({
		config: { ...central, kinds: { caller, helper: typedKind } },
		warnings: [],
	});
	expect(central.kinds).toEqual({ caller });
});

test("effective configuration rejects unknown kind selectors", () => {
	const central: BeesConfig = {
		...typedConfig,
		kinds: { caller: { ...typedKind, allow: ["missing"] } },
	};
	expect(() => resolveBeesConfig({ config: central, source: CENTRAL }, [])).toThrow(Error);
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

test("root bees.toml is not a fallback #test-618", async () => {
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

test("a centrally shadowed folder still requires its definition file", async () => {
	const failure = await loadBeesConfig(
		"/repo",
		fixture({
			[CENTRAL]: POLICY + INLINE,
			"/repo/.hive/bees/a/prompt.md": "Shadowed prompt",
		}),
	).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(Error);
	expect(failure).toMatchObject({ cause: { code: "ENOENT" } });
	expect(failure).toMatchInlineSnapshot(
		`[Error: Cannot load /repo/.hive/bees/a/bee.toml: Error: Missing fixture /repo/.hive/bees/a/bee.toml]`,
	);
});

test("prompt read errors other than ENOENT retain nested paths and causes", async () => {
	const prompt = "/repo/.hive/bees/a/prompt.md";
	const denied = Object.assign(new Error("Denied"), { code: "EACCES" });
	const files = fixture({
		[CENTRAL]: POLICY,
		"/repo/.hive/bees/a/bee.toml": DEFINITION,
	});
	const failure = await loadBeesConfig("/repo", {
		...files,
		readText: (path) => {
			if (path === prompt) {
				return Promise.reject(denied);
			}
			return files.readText(path);
		},
	}).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(Error);
	expect(failure).toMatchObject({ cause: { cause: denied } });
	expect(failure).toMatchInlineSnapshot(
		`[Error: Cannot load /repo/.hive/bees/a/bee.toml: Error: Cannot load /repo/.hive/bees/a/prompt.md: Error: Denied]`,
	);
});

test("malformed canonical input retains its source path and parser cause", async () => {
	const failure = await loadBeesConfig("/repo", fixture({ [CENTRAL]: "not valid TOML" })).catch(
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(Error);
	expect(failure).toMatchObject({ cause: expect.any(Error) });
	expect(failure).toMatchInlineSnapshot(
		`[Error: Cannot load /repo/.hive/bees.toml: SyntaxError: TOML Parse error: Expected '=' after a key but found 'v']`,
	);
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
				return Promise.reject(
					Object.assign(new Error(`Missing fixture ${path}`), { code: "ENOENT" }),
				);
			}
			return Promise.resolve(text);
		},
	};
}
