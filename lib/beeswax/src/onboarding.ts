import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Generated adapters stay inside the supplied checkout.
import { join } from "node:path";
import { renderPrime } from "./prime.ts";
import { z } from "zod";

const marker = "Beeswax onboarding v1";
const begin = "// beeswax:begin onboarding v1";
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
			if (!selected && !/Beeswax onboarding|beeswax:.*onboarding|beeswax prime/u.test(current)) {
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
	if (!selected && !owned) {
		return current;
	}
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
	if (selected && owned && Bun.deepEquals(owned.handler, desired)) {
		return current;
	}
	const groups = settings.hooks?.SessionStart ?? [];
	if (owned) {
		owned.group.hooks = owned.group.hooks.filter((handler) => handler !== owned.handler);
	}
	const remaining = groups.filter((group) => group !== owned?.group || group.hooks.length > EMPTY);
	if (selected) {
		remaining.push({ hooks: [desired] });
	}
	settings.hooks = { ...settings.hooks, SessionStart: remaining };
	return `${JSON.stringify(settings, undefined, "\t")}\n`;
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
