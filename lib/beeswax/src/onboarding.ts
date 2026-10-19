import {
	isPreviousPiSection,
	piAdapterSection,
	piPayloadPath,
	renderPiPayload,
	requireOwnedPiPayload,
} from "./pi-onboarding.ts";
import { BeeswaxError } from "./errors.ts";
import type { ProjectConfig } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { digestConfig } from "./config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Generated adapters stay inside the supplied checkout.
import { join } from "node:path";
import { renderPrime } from "./prime.ts";
import { z } from "zod";

const marker = "Beeswax onboarding v1";
const EMPTY = 0;
const SINGLE = 1;
const DELIMITERS = 2;
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
	project: ProjectConfig,
	io: WorkspaceIO,
): Promise<string[]> {
	const config = project.onboarding;
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
				!/Beeswax (?:onboarding|tracker alerts)|beeswax:.*onboarding|beeswax (?:prime|(?:system )?harness-alert)/u.test(
					current,
				)
			) {
				return;
			}
			let replace = (adapter: Adapter): string | undefined => replaceHook(adapter, flags);
			if (harness === "pi") {
				replace = replacePi;
			}
			const contents = replace({ path, current, selected });
			if (contents === current) {
				return;
			}
			return { path, contents };
		}),
	);
	planned.push(...(await planPiPayload(root, project, io)));
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
			!/^Beeswax onboarding v[01]$/u.test(String(owned.handler.statusMessage)) ||
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
	const command = `beeswax system harness-alert --harness ${harness}`;
	const previousCommand = `beeswax harness-alert --harness ${harness}`;
	const events = ["SessionStart", "UserPromptSubmit", "PostToolUse"];
	const seen = new Set<string>();
	for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
		const emptied = new Set<object>();
		for (const group of groups) {
			group.hooks = group.hooks.filter((handler) => {
				const ours =
					String(handler.statusMessage).startsWith("Beeswax tracker alerts") ||
					/^beeswax (?:system )?harness-alert\b/u.test(String(handler.command));
				if (!ours) {
					return true;
				}
				if (
					seen.has(event) ||
					!events.includes(event) ||
					handler.type !== "command" ||
					handler.statusMessage !== "Beeswax tracker alerts v1" ||
					(handler.command !== command && handler.command !== previousCommand) ||
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
function replacePi({ current, selected, path }: Adapter): string | undefined {
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
	const owned = matches.at(EMPTY)?.[EMPTY];
	if (owned && owned !== piAdapterSection && !isPreviousPiSection(owned)) {
		throw handoff(
			path,
			"The Pi section was edited or has an unsupported version.",
			piAdapterSection,
		);
	}
	let replacement = "";
	if (selected) {
		replacement = piAdapterSection;
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

// eslint-disable-next-line max-statements -- Validate one exact ignore section and retain outside bytes.
function replacePayloadIgnore(path: string, current: string, selected: boolean): string {
	const section =
		"# beeswax:begin pi-payload v1\n/.hive/beeswax/generated/pi-beeswax.js\n# beeswax:end pi-payload\n";
	const matches = [
		...current.matchAll(
			/^# beeswax:begin pi-payload[^\n]*\n[\s\S]*?^# beeswax:end pi-payload(?:\n|$)/gmu,
		),
	];
	const delimiters = current.match(/^# beeswax:(?:begin|end) pi-payload/gmu) ?? [];
	if (
		matches.length > SINGLE ||
		delimiters.length !== matches.length * DELIMITERS ||
		(matches.length === SINGLE && matches[EMPTY]![EMPTY] !== section)
	) {
		throw handoff(
			path,
			"The Pi payload ignore section is edited, duplicated or unsupported.",
			section,
		);
	}
	if (matches.length === SINGLE) {
		let replacement = "";
		if (selected) {
			replacement = section;
		}
		return current.replace(matches[EMPTY]![EMPTY], () => replacement);
	}
	if (!selected) {
		return current;
	}
	let separator = "";
	if (current !== "" && !current.endsWith("\n")) {
		separator = "\n";
	}
	return `${current}${separator}${section}`;
}

// eslint-disable-next-line max-statements -- Preflight payload and portable ignore before adapter writes.
async function planPiPayload(root: string, project: ProjectConfig, io: WorkspaceIO) {
	const config = project.onboarding;
	const planned: { path: string; contents: string | undefined }[] = [];
	const payload = join(root, piPayloadPath);
	const previous = await io.read(payload);
	if (await io.exists(payload)) {
		requireOwnedPiPayload(payload, previous);
	}
	const selected = config?.harnesses.includes("pi") ?? false;
	let desired = "";
	if (selected && config) {
		desired = renderPiPayload(config, digestConfig(project));
	}
	if (previous !== desired) {
		let contents: string | undefined = desired;
		if (!selected) {
			contents = undefined;
		}
		planned.push({ path: payload, contents });
	}
	const ignorePath = join(root, ".gitignore");
	const currentIgnore = await io.read(ignorePath);
	const nextIgnore = replacePayloadIgnore(ignorePath, currentIgnore, selected);
	if (currentIgnore !== nextIgnore) {
		planned.push({ path: ignorePath, contents: nextIgnore });
	}
	return planned;
}
