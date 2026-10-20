import { expect, test } from "bun:test";
import { BeeswaxError } from "./errors.ts";
import type { OnboardingConfig } from "./onboarding.ts";
import { applyOnboarding } from "./onboarding.ts";
import { fixture } from "../tests/support.ts";

const root = "/repo";
const codex = `${root}/.codex/hooks.json`;
const alertHook = {
	hooks: [
		{
			type: "command",
			command: "beeswax system harness-alert --harness codex",
			statusMessage: "Beeswax tracker alerts v1",
		},
	],
};
const identityHook = {
	hooks: [
		{
			type: "command",
			command: "scent system hook --harness codex",
			statusMessage: "Beeswax identity v1",
		},
	],
	matcher: "^(startup|resume|clear|compact)$",
};
const pi = `${root}/.pi/extensions/beeswax.js`;
const config: OnboardingConfig = {
	harnesses: ["claude", "codex", "pi"],
	include: ["colony"],
	exclude: ["bee"],
};
const template = fixture();
await applyOnboarding(root, config, template.deps);
// Execute only our generated fixture, without filesystem or a live harness.
// eslint-disable-next-line no-new-func -- Verify emitted JavaScript through its public extension API.
const piAdapter = new Function(`${template.files.get(pi)?.replace("export default", "return")} `)();
const FIRST = 0;
const USER_GROUPS = 2;
const LAST = -1;
const CONTEXT_PREVIEW_CHARACTERS = 2000;

interface ContextMessage {
	/** Model-visible message content in the generated adapter fixture. */
	content: string;
	/** Identity of the adapter's replaceable context contribution. */
	customType?: string;
}
interface ContextInput {
	/** Context composed by preceding extensions. */
	messages: ContextMessage[];
}
interface PiContext {
	/** Code checkout, independent of tracker selection. */
	cwd: string;
	/** Stable native session identity. */
	sessionManager: { getSessionId: () => string };
}
type ContextHandler = (event: ContextInput, ctx: PiContext) => Promise<ContextInput>;

test("selected repo-local hooks invoke the filtered primer and repeated setup is unchanged #test-367", async () => {
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
		alertHook,
		identityHook,
	]);
	const before = new Map(fx.files);
	expect(await applyOnboarding(root, config, fx.deps)).toEqual([]);
	expect(fx.files).toEqual(before);
});

test.each([
	{ harness: "claude", path: `${root}/.claude/settings.json` },
	{ harness: "codex", path: codex },
])(
	"$harness identity callbacks are owned, stable and removed with harness deselection #test-440",
	// eslint-disable-next-line max-statements -- Verify one complete owned integration lifecycle.
	async ({ harness, path }) => {
		const fx = configured();
		const settings = JSON.parse(fx.files.get(path) ?? "");
		const unrelated = { hooks: [{ type: "command", command: "echo user" }] };
		settings.hooks.SessionStart.unshift(unrelated);
		fx.files.set(path, JSON.stringify(settings));
		await applyOnboarding(root, config, fx.deps);
		const installed = JSON.parse(fx.files.get(path) ?? "");
		const identity = {
			hooks: [
				{
					type: "command",
					command: `scent system hook --harness ${harness}`,
					statusMessage: "Beeswax identity v1",
				},
			],
		};
		expect(installed.hooks.SessionStart).toContainEqual({
			...identity,
			matcher: "^(startup|resume|clear|compact)$",
		});
		expect(installed.hooks.SubagentStart).toContainEqual(identity);
		expect(installed.hooks.SessionStart[FIRST]).toEqual(unrelated);
		const before = new Map(fx.files);
		expect(await applyOnboarding(root, config, fx.deps)).toEqual([]);
		expect(fx.files).toEqual(before);
		await applyOnboarding(root, undefined, fx.deps);
		const removed = JSON.parse(fx.files.get(path) ?? "");
		expect(removed.hooks.SessionStart).toEqual([unrelated]);
		expect(fx.files.get(path)).not.toContain("scent system hook");
	},
);

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
				alertHook,
				identityHook,
			],
			UserPromptSubmit: [alertHook],
			PostToolUse: [alertHook],
			SubagentStart: [{ hooks: identityHook.hooks }],
		},
	});
});

test("owned alert callbacks adopt the system command while preserving user hooks", async () => {
	const fx = configured();
	const current = fx.files.get(codex)!;
	fx.files.set(codex, current.replaceAll("beeswax system harness-alert", "beeswax harness-alert"));
	await applyOnboarding(root, config, fx.deps);
	expect(fx.files.get(codex)).toBe(current);
});

test("Pi section updates and removal preserve source outside the owned brackets #test-406", async () => {
	const fx = configured();
	const generated = fx.files.get(pi) ?? "";
	fx.files.set(pi, `// before\n${generated.replace("onboarding v2", "onboarding v0")}// after\n`);
	await applyOnboarding(root, config, fx.deps);
	expect(fx.files.get(pi)).toBe(`// before\n${generated}// after\n`);
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.get(pi)).toBe("// before\n// after\n");
	expect(fx.files.get(codex)).not.toContain("Beeswax onboarding");
});

test("deselection removes an otherwise empty generated Pi file #test-498", async () => {
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
	{
		path: `${root}/.pi/extensions/scent.js`,
		content: "// beeswax:begin identity v1\nincomplete",
	},
	{
		path: codex,
		content: JSON.stringify({
			hooks: {
				SessionStart: [{ ...identityHook, matcher: "startup" }],
			},
		}),
	},
])(
	"ambiguous $path supplies an agent handoff before any files change #test-448",
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

test("a mismatched installed identity runtime refuses setup before adapter writes", async () => {
	const fx = configured();
	const before = new Map(fx.files);
	fx.deps.command = () => Promise.resolve("0.0.0");
	const failure: unknown = await applyOnboarding(root, config, fx.deps).catch(
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(BeeswaxError);
	expect(failure).toMatchObject({ reason: "identity_runtime_mismatch" });
	expect(fx.files).toEqual(before);
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.get(codex)).not.toContain("Beeswax identity");
});

test("Pi identity loader is owned and preserves surrounding source through refresh and removal #test-458", async () => {
	const fx = configured();
	const path = `${root}/.pi/extensions/scent.js`;
	const generated = fx.files.get(path) ?? "";
	fx.files.set(path, `// before\n${generated}// after\n`);
	await applyOnboarding(root, config, fx.deps);
	expect(fx.files.get(path)).toBe(`// before\n${generated}// after\n`);
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.get(path)).toBe("// before\n// after\n");
});

// eslint-disable-next-line max-statements -- Check preservation and refusal before any writes.
test("alert callback ownership preserves user groups and rejects edited execution options #test-439", async () => {
	const fx = configured();
	const settings = JSON.parse(fx.files.get(codex) ?? "");
	const unrelated = { matcher: "Bash", hooks: [{ type: "command", command: "echo user" }] };
	settings.hooks.PostToolUse.unshift(unrelated, { hooks: [] });
	fx.files.set(codex, JSON.stringify(settings));
	await applyOnboarding(root, config, fx.deps);
	expect(JSON.parse(fx.files.get(codex) ?? "").hooks.PostToolUse.slice(FIRST, USER_GROUPS)).toEqual(
		[unrelated, { hooks: [] }],
	);
	settings.hooks.UserPromptSubmit[FIRST].hooks[FIRST].async = true;
	fx.files.set(codex, JSON.stringify(settings));
	const before = new Map(fx.files);
	expect(
		await applyOnboarding(root, config, fx.deps).catch((error: unknown) => error),
	).toBeInstanceOf(BeeswaxError);
	expect(fx.files).toEqual(before);
});

test("deselection removes alert callbacks even when the startup primer was already removed", async () => {
	const fx = configured();
	const settings = JSON.parse(fx.files.get(codex) ?? "");
	settings.hooks.SessionStart.shift();
	fx.files.set(codex, JSON.stringify(settings));
	await applyOnboarding(root, undefined, fx.deps);
	expect(fx.files.get(codex)).not.toContain("harness-alert");
});

test("generated Pi context callbacks replace their own message and preserve other extensions", async () => {
	const fx = piFixture();
	const before = { messages: [{ content: "other extension", customType: "other" }] };
	const first = await fx.context(before);
	expect(first.messages.map((message) => message.content)).toEqual([
		"other extension",
		"active hold",
	]);
	fx.output.context = "verified clearance";
	const next = await fx.context(first);
	expect(next.messages.map((message) => message.content)).toEqual([
		"other extension",
		"verified clearance",
	]);
	expect(JSON.parse(fx.arguments.at(LAST) ?? "")).toEqual({
		session_id: "native-session",
		cwd: "/code/worktree",
		hook_event_name: "context",
	});
});

test("generated Pi callback delivers holds after failed invocation or invalid output", async () => {
	const fx = piFixture();
	fx.output.context = undefined;
	const invalid = await fx.context({ messages: [] });
	expect(invalid.messages[FIRST]?.content).toContain("known hold");
	fx.fail();
	const failed = await fx.context({ messages: [] });
	expect(failed.messages[FIRST]?.content).toContain("do not merge");
});

test("generated Pi fallback puts immediate guidance before long diagnostics", async () => {
	const fx = piFixture();
	const reason = "diagnostic ".repeat(CONTEXT_PREVIEW_CHARACTERS);
	fx.fail(reason);
	const failed = await fx.context({ messages: [] });
	const content = failed.messages[FIRST]?.content;
	const preview = content?.slice(FIRST, CONTEXT_PREVIEW_CHARACTERS);
	expect(preview).toContain("do not merge");
	expect(preview).toContain("Unrelated non-Beads work");
	expect(preview).toContain("authorized");
	expect(content).toContain(reason);
});

// --- Private functions ---

function piFixture() {
	const handlers = new Map<string, ContextHandler>();
	const output: { context: string | undefined } = { context: "active hold" };
	const args: string[] = [];
	const execution: { failure?: Error } = {};
	piAdapter({
		on: (event: string, handler: ContextHandler) => handlers.set(event, handler),
		exec: (_command: string, argv: string[]) => {
			if (execution.failure) {
				throw execution.failure;
			}
			args.splice(FIRST, args.length, ...argv);
			return Promise.resolve({ code: 0, stdout: JSON.stringify(output), stderr: "" });
		},
	});
	return {
		output,
		arguments: args,
		fail: (message = "command unavailable") => {
			execution.failure = new Error(message);
		},
		context: (event: ContextInput) =>
			handlers.get("context")!(event, {
				cwd: "/code/worktree",
				sessionManager: { getSessionId: () => "native-session" },
			}),
	};
}

function configured() {
	const fx = fixture();
	for (const [path, contents] of template.files) {
		fx.files.set(path, contents);
	}
	return fx;
}
