import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Generated adapters stay inside the supplied checkout.
import { join } from "node:path";
import { renderPrime } from "./prime.ts";
import { z } from "zod";

const marker = "Beeswax onboarding v1";
const begin = "// beeswax:begin onboarding v2";
const end = "// beeswax:end onboarding";
const EMPTY = 0;
const SINGLE = 1;
const targets = {
	claude: ".claude/settings.json",
	codex: ".codex/hooks.json",
	pi: ".pi/extensions/beeswax.js",
} as const;
const handlerSchema = z.record(z.string(), z.unknown());
const groupSchema = z.looseObject({ hooks: z.array(handlerSchema) });
const settingsSchema = z.looseObject({
	hooks: z.record(z.string(), z.array(groupSchema)).optional(),
});

export const onboardingSchema = z.strictObject({
	harnesses: z.array(z.enum(["claude", "codex", "pi"])).nonempty(),
	include: z.array(z.string()),
	exclude: z.array(z.string()),
});
export type OnboardingConfig = z.infer<typeof onboardingSchema>;
type Settings = z.infer<typeof settingsSchema>;
interface Adapter {
	/** Destination in the target checkout. */
	path: string;
	/** Current source, or empty for an absent file. */
	current: string;
	/** Whether this harness should receive the primer. */
	selected: boolean;
}

/** Replace recognized owned adapters, preserving surrounding settings and source text. */
export async function applyOnboarding(
	root: string,
	config: OnboardingConfig | undefined,
	io: WorkspaceIO,
): Promise<string[]> {
	const flags = [
		...(config?.include ?? []).flatMap((name) => ["--include", name]),
		...(config?.exclude ?? []).flatMap((name) => ["--exclude", name]),
	];
	if (config) {
		renderPrime(config);
	}
	const planned = await Promise.all(
		// eslint-disable-next-line max-statements -- Plan each adapter before writing any files.
		Object.entries(targets).map(async ([harness, target]) => {
			const path = join(root, target);
			const current = await io.read(path);
			const selected = config?.harnesses.some((name) => name === harness) ?? false;
			if (
				!selected &&
				!/Beeswax (?:onboarding|tracker alerts)|beeswax:.*onboarding|beeswax (?:prime|harness-alert)/u.test(
					current,
				)
			) {
				return;
			}
			let replace: typeof replacePi = replaceHook;
			if (harness === "pi") {
				replace = replacePi;
			}
			const contents = replace({ path, current, selected }, flags);
			if (contents === current) {
				return;
			}
			return { path, contents };
		}),
	);
	const changes = planned.filter((change) => change !== undefined);
	await Promise.all(
		changes.map(async ({ path, contents }) => {
			if (contents === undefined) {
				await io.remove(path);
				return;
			}
			await io.write(path, contents);
		}),
	);
	return changes.map(({ path }) => path);
}

// --- Private functions ---

// eslint-disable-next-line max-statements -- Keep recognition and the shared-settings edit together.
function replaceHook({ current, selected, path }: Adapter, flags: string[]): string {
	const command = ["beeswax", "prime", ...flags].join(" ");
	let settings: Settings = {};
	try {
		settings = settingsSchema.parse(JSON.parse(current || "{}"));
	} catch {
		throw handoff(path, "The shared harness settings are not valid hook JSON.", command);
	}
	const matches = Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
		groups.flatMap((group) =>
			group.hooks
				.filter(
					(handler) =>
						(typeof handler.statusMessage === "string" &&
							handler.statusMessage.startsWith("Beeswax onboarding")) ||
						(typeof handler.command === "string" && /^beeswax prime\b/u.test(handler.command)),
				)
				.map((handler) => ({ event, group, handler })),
		),
	);
	if (matches.length > SINGLE) {
		throw handoff(path, "Several onboarding entries could be ours.", command);
	}
	const owned = matches.at(EMPTY);
	if (
		owned &&
		(owned.event !== "SessionStart" ||
			owned.handler.type !== "command" ||
			!/^Beeswax onboarding v\d+$/u.test(String(owned.handler.statusMessage)) ||
			!/^beeswax prime(?: --(?:include|exclude) [a-z][a-z-]*)*$/u.test(
				String(owned.handler.command),
			) ||
			Object.keys(owned.handler).some(
				(key) => !["type", "command", "statusMessage"].includes(key),
			) ||
			Object.keys(owned.group).some((key) => key !== "hooks"))
	) {
		throw handoff(
			path,
			"The onboarding entry has an unfamiliar command, marker or execution options.",
			command,
		);
	}
	const desired = { type: "command", command, statusMessage: marker };
	const groups = settings.hooks?.SessionStart ?? [];
	if (owned) {
		owned.group.hooks = owned.group.hooks.filter((handler) => handler !== owned.handler);
	}
	const remaining = groups.filter((group) => group !== owned?.group || group.hooks.length > EMPTY);
	if (selected) {
		remaining.push({ hooks: [desired] });
	}
	if (selected || owned) {
		settings.hooks = { ...settings.hooks, SessionStart: remaining };
	}
	replaceAlertHooks(settings, { current, selected, path });
	if (Bun.deepEquals(settings, JSON.parse(current || "{}"))) {
		return current;
	}
	return `${JSON.stringify(settings, undefined, "\t")}\n`;
}

// eslint-disable-next-line max-statements -- Validate owned alert hooks before replacing them as a group.
function replaceAlertHooks(settings: Settings, { selected, path }: Adapter): void {
	let harness = "claude";
	if (path.endsWith(targets.codex)) {
		harness = "codex";
	}
	const command = `beeswax harness-alert --harness ${harness}`;
	const events = ["SessionStart", "UserPromptSubmit", "PostToolUse"];
	const seen = new Set<string>();
	for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
		const emptied = new Set<object>();
		for (const group of groups) {
			group.hooks = group.hooks.filter((handler) => {
				const ours =
					String(handler.statusMessage).startsWith("Beeswax tracker alerts") ||
					/^beeswax harness-alert\b/u.test(String(handler.command));
				if (!ours) {
					return true;
				}
				if (
					seen.has(event) ||
					!events.includes(event) ||
					handler.type !== "command" ||
					!/^Beeswax tracker alerts v\d+$/u.test(String(handler.statusMessage)) ||
					handler.command !== command ||
					Object.keys(handler).some((key) => !["type", "command", "statusMessage"].includes(key)) ||
					Object.keys(group).some((key) => key !== "hooks")
				) {
					throw handoff(
						path,
						"The tracker-alert hook has unfamiliar ownership or execution options.",
						command,
					);
				}
				seen.add(event);
				emptied.add(group);
				return false;
			});
		}
		settings.hooks = {
			...settings.hooks,
			[event]: groups.filter((group) => group.hooks.length > EMPTY || !emptied.has(group)),
		};
	}
	if (selected) {
		for (const event of events) {
			settings.hooks = {
				...settings.hooks,
				[event]: [
					...(settings.hooks?.[event] ?? []),
					{ hooks: [{ type: "command", command, statusMessage: "Beeswax tracker alerts v1" }] },
				],
			};
		}
	}
}

// eslint-disable-next-line max-statements -- Keep bracket recognition and replacement together.
function replacePi({ current, selected, path }: Adapter, flags: string[]): string | undefined {
	const section =
		/^\/\/ beeswax:begin onboarding v\d+\n[\s\S]*?^\/\/ beeswax:end onboarding(?:\n|$)/gmu;
	const matches = [...current.matchAll(section)];
	const delimiters = current.match(/^\/\/ beeswax:(?:begin|end) onboarding/gmu) ?? [];
	if (
		matches.length > SINGLE ||
		(current !== "" && (matches.length === EMPTY || delimiters.length !== SINGLE + SINGLE))
	) {
		throw handoff(
			path,
			"The Pi file has no single complete versioned onboarding section.",
			"A repo-local Pi primer extension",
		);
	}
	let replacement = "";
	if (selected) {
		replacement = [
			begin,
			"export default function (pi) {",
			'\tpi.on("before_agent_start", async (event) => {',
			`\t\tconst result = await pi.exec("beeswax", ${JSON.stringify(["prime", ...flags])});`,
			// eslint-disable-next-line no-template-curly-in-string -- This template is evaluated by the emitted Pi extension.
			"\t\tif (result.code !== 0) throw new Error(`beeswax prime failed: ${result.stderr}`);",
			"\t\tevent.systemPromptOptions.sections.beeswax = result.stdout.trimEnd();",
			"\t});",
			'\tpi.on("context", async (event, ctx) => {',
			"\t\tconst payload = JSON.stringify({ session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, " +
				'hook_event_name: "context" });',
			"\t\tlet context;",
			"\t\ttry {",
			'\t\t\tconst result = await pi.exec("beeswax", ' +
				'["harness-alert", "--harness", "pi", "--input", payload], { timeout: 5000 });',
			"\t\t\tif (result.code !== 0) throw new Error(result.stderr);",
			"\t\t\tconst output = JSON.parse(result.stdout);",
			'\t\t\tif (typeof output.context !== "string") throw new Error("Invalid alert callback output");',
			"\t\t\tcontext = output.context;",
			"\t\t} catch (error) {",
			'\t\t\tcontext = "Beeswax tracker alert check failed. ' +
				"Stop Beads workflows and ordinary tracker operations on the selected endpoint; do not merge. " +
				"Unrelated non-Beads work and explicitly user-authorized native tracker inspection/recovery may continue. " +
				"Recheck independent alert status. With no known hold, a healthy check of this endpoint " +
				"with no active incident restores baseline; do not announce clearance. " +
				"Clearance is unverified for any known hold, including a handoff or sync failure. " +
				"A failed check or missing receipt cannot release it. " +
				"Announce verified matching or newer clearance before resuming that work. " +
				'Diagnostics: " + String(error);',
			"\t\t}",
			'\t\tconst messages = event.messages.filter((message) => message.customType !== "beeswax-tracker-alert");',
			'\t\tif (context) messages.push({ role: "custom", customType: "beeswax-tracker-alert", ' +
				"content: context, display: true, timestamp: Date.now() });",
			"\t\treturn { messages };",
			"\t});",
			"}",
			end,
			"",
		].join("\n");
	}
	let next = replacement;
	if (matches.length === SINGLE) {
		next = current.replace(section, () => replacement);
	}
	if (next.trim() === "") {
		return undefined;
	}
	return next;
}

function handoff(path: string, observed: string, desired: string): BeeswaxError {
	return new BeeswaxError(
		"onboarding_ambiguous",
		`${path}: ${observed} Run beeswax migrate setup for agent-guided resolution.`,
		{
			context: {
				path,
				observed,
				desired,
				nextCommand: "beeswax migrate setup",
				guidance: "beeswax skills file repository-setup references/setup-migration.md",
				requiresUser: true,
			},
		},
	);
}
