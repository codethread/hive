import { expect, test } from "bun:test";
import { BeeswaxError } from "./errors.ts";
import type { OnboardingConfig } from "./onboarding.ts";
import { applyOnboarding } from "./onboarding.ts";
import { fixture } from "../tests/support.ts";

const root = "/repo";
const codex = `${root}/.codex/hooks.json`;
const pi = `${root}/.pi/extensions/beeswax.js`;
const config: OnboardingConfig = {
	harnesses: ["claude", "codex", "pi"],
	include: ["colony"],
	exclude: ["bee"],
};
const template = fixture();
await applyOnboarding(root, config, template.deps);

test("selected repo-local hooks invoke the filtered primer and repeated setup is unchanged", async () => {
	const fx = configured();
	expect(JSON.parse(fx.files.get(codex) ?? "").hooks.SessionStart).toEqual([
		{
			hooks: [
				{
					type: "command",
					command: "beeswax prime --include colony --exclude bee",
					statusMessage: "Beeswax onboarding v1",
				},
			],
		},
	]);
	const before = new Map(fx.files);
	expect(await applyOnboarding(root, config, fx.deps)).toEqual([]);
	expect(fx.files).toEqual(before);
});

test("recognized older JSON entries update automatically while preserving user settings", async () => {
	const fx = configured();
	fx.files.set(
		codex,
		JSON.stringify({
			preferences: { keep: true },
			hooks: {
				SessionStart: [
					{
						hooks: [
							{ type: "command", command: "beeswax prime", statusMessage: "Beeswax onboarding v0" },
							{ type: "command", command: "echo user-hook" },
						],
					},
				],
			},
		}),
	);
	await applyOnboarding(root, config, fx.deps);
	expect(JSON.parse(fx.files.get(codex) ?? "")).toEqual({
		preferences: { keep: true },
		hooks: {
			SessionStart: [
				{ hooks: [{ type: "command", command: "echo user-hook" }] },
				{
					hooks: [
						{
							type: "command",
							command: "beeswax prime --include colony --exclude bee",
							statusMessage: "Beeswax onboarding v1",
						},
					],
				},
			],
		},
	});
});

test("Pi section updates and removal preserve source outside the owned brackets", async () => {
	const fx = configured();
	const generated = fx.files.get(pi) ?? "";
	fx.files.set(pi, `// before\n${generated.replace("onboarding v1", "onboarding v0")}// after\n`);
	await applyOnboarding(root, config, fx.deps);
	expect(fx.files.get(pi)).toBe(`// before\n${generated}// after\n`);
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.get(pi)).toBe("// before\n// after\n");
	expect(fx.files.get(codex)).not.toContain("Beeswax onboarding");
});

test("deselection removes an otherwise empty generated Pi file", async () => {
	const fx = configured();
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.has(pi)).toBe(false);
});

test.each([
	{ path: codex, content: "invalid JSON" },
	{
		path: codex,
		content:
			'{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"beeswax prime"}]}]}}',
	},
	{
		path: codex,
		content: JSON.stringify({
			hooks: {
				SessionStart: [
					{
						hooks: [
							{
								type: "command",
								command: "echo edited",
								statusMessage: "Beeswax onboarding v1",
							},
						],
					},
				],
			},
		}),
	},
	{ path: pi, content: "// beeswax:begin onboarding v1\nincomplete" },
	{ path: pi, content: "export default function userExtension() {}" },
])(
	"ambiguous $path supplies an agent handoff before any files change",
	async ({ path, content }) => {
		const fx = configured();
		fx.files.set(path, content);
		const before = new Map(fx.files);
		const failure: unknown = await applyOnboarding(root, config, fx.deps).catch(
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(BeeswaxError);
		expect(failure).toMatchObject({
			reason: "onboarding_ambiguous",
			context: {
				path,
				observed: expect.any(String),
				desired: expect.any(String),
				nextCommand: "beeswax migrate setup",
				guidance: "beeswax skills file repository-setup references/setup-migration.md",
			},
		});
		expect(fx.files).toEqual(before);
	},
);

test("unselected unrelated settings are left alone", async () => {
	const fx = fixture();
	fx.files.set(codex, "unrelated invalid settings");
	expect(await applyOnboarding(root, undefined, fx.deps)).toEqual([]);
	expect(fx.files.get(codex)).toBe("unrelated invalid settings");
});

// --- Private functions ---

function configured() {
	const fx = fixture();
	for (const [path, contents] of template.files) {
		fx.files.set(path, contents);
	}
	return fx;
}
