/* eslint-disable no-await-in-loop -- Preflight all configured files before ordered generation effects. */
import { BeeswaxError, EXIT } from "./errors.ts";
import { hookSection, previousHookSection } from "./templates.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve declared hook files and Git metadata.
import { join, resolve } from "node:path";
import { readMergeReceipt, writeMergeReceipt } from "./receipts.ts";
import type { MergeReceipt } from "./receipts.ts";
import type { ProjectConfig } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { projectMigration } from "./project.ts";

export { hookSection } from "./templates.ts";

const FIRST = 0;
const SINGLE = 1;

const mode = 0o755;

/** Own only a delimited requirement; application code before and after it remains untouched. */
// eslint-disable-next-line max-statements -- Parse and verify one owned section without touching surrounding bytes.
export function updateHookSection(contents: string): string {
	if (contents === "") {
		return `#!/usr/bin/env sh\n${hookSection}\n`;
	}
	const starts = [...contents.matchAll(/^# beeswax:begin tracker-validation.*$/gmu)];
	const ends = [...contents.matchAll(/^# beeswax:end tracker-validation.*$/gmu)];
	if (starts.length !== SINGLE || ends.length !== SINGLE) {
		throw hookMigration(
			"A configured hook needs an agreed insertion point or has ambiguous Beeswax sections.",
		);
	}
	const start = starts[FIRST]!.index;
	const finish = ends[FIRST]!.index + ends[FIRST]![FIRST].length;
	const section = contents.slice(start, finish);
	if (finish <= start || (section !== hookSection && section !== previousHookSection)) {
		throw hookMigration("The Beeswax section was edited or has an unsupported generator revision.");
	}
	return `${contents.slice(FIRST, start)}${hookSection}${contents.slice(finish)}`;
}

/** Generate only declared sections, never a general application-hook dispatcher. */
// eslint-disable-next-line max-statements -- Preflight all files before applying the generated sections.
export async function installHooks(
	options: { root: string; config: ProjectConfig },
	io: WorkspaceIO,
): Promise<string[]> {
	const { root, config } = options;
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const plans: { path: string; before: string; after: string; created: boolean }[] = [];
	for (const target of new Set(Object.values(config.hooks))) {
		let path = resolve(root, target);
		if (target.startsWith(".git/")) {
			path = resolve(common, target.slice(".git/".length));
		}
		const before = await io.read(path);
		plans.push({
			path,
			before,
			after: updateHookSection(before),
			created: !(await io.exists(path)),
		});
	}
	for (const plan of plans) {
		if (plan.before !== plan.after) {
			await io.write(plan.path, plan.after);
		}
		if (plan.created) {
			await io.chmod(plan.path, mode);
		}
	}
	return plans.map(({ path }) => path);
}

/** Register Git's merge protocol against an installed command, independent of source scripts. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function installMergeDriver(
	root: string,
	executable: string,
	io: WorkspaceIO,
): Promise<void> {
	const values: MergeReceipt["config"] = {
		"merge.hive-beads.name": "Hive Beads JSONL merge driver",
		"merge.hive-beads.driver": `${shellQuote(executable)} system git merge "%O" "%A" "%B"`,
		"merge.hive-beads.recursive": "hive-beads",
	};
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const receipt = await readMergeReceipt(common, io);
	const gitConfig = await planGitIntegration(
		{ root, common, kind: "merge-driver", values, previous: receipt?.config },
		io,
	);
	const path = join(root, ".gitattributes");
	const contents = await io.read(path);
	const entry = ".beads/issues.jsonl text eol=lf merge=hive-beads";
	const section = [
		"# beeswax:begin merge-attributes v1",
		entry,
		"# beeswax:end merge-attributes",
	].join("\n");
	let attributes = replaceGitFence(
		contents,
		{ name: "merge-attributes", path },
		{
			current: section,
			previous: section,
		},
	);
	if (attributes === undefined) {
		const entries = [
			...contents.matchAll(
				/^[ \t]*\/?(?:\.beads\/issues\.jsonl|"\/?\.beads\/issues\.jsonl")(?:[ \t].*)?$/gmu,
			),
		];
		if (entries.length === FIRST) {
			attributes = contents;
		} else {
			if (entries.length !== SINGLE || entries[FIRST]![FIRST] !== receipt?.attribute) {
				throw projectMigration(
					`Unowned or duplicate tracker attributes in ${path}. ` +
						"Move the old .hive/beeswax/meta/merge-driver.local.json receipt to " +
						`${join(common, "beeswax/merge-driver.local.json")} and review its unchanged generation before adoption.`,
				);
			}
			const matched = entries[FIRST]!;
			let end = matched.index + matched[FIRST].length;
			if (contents[end] === "\n") {
				end += SINGLE;
			}
			attributes = `${contents.slice(FIRST, matched.index)}${contents.slice(end)}`;
		}
		attributes = appendGitSection(attributes, section);
	} else {
		const outside = contents.replace(section, "");
		if (
			/^[ \t]*\/?(?:\.beads\/issues\.jsonl|"\/?\.beads\/issues\.jsonl")(?:[ \t]|$)/mu.test(outside)
		) {
			throw projectMigration(`Duplicate tracker attributes outside the Beeswax fence in ${path}.`);
		}
	}
	if (gitConfig.before !== gitConfig.after) {
		await io.write(gitConfig.path, gitConfig.after);
	}
	if (attributes !== contents) {
		await io.write(path, attributes);
	}
	await writeMergeReceipt(common, { config: values, attribute: entry }, io);
}

/** Validate Beeswax's tracker requirement without running or choosing application checks. */
export async function validateTrackerHook(
	root: string,
	io: Pick<WorkspaceIO, "command">,
	validate: () => Promise<void>,
): Promise<boolean> {
	const selected = await isTrackerSnapshot(root, io);
	if (selected) {
		await validate();
	}
	return selected;
}

/** Quote one executable for Git configuration and generated shell hook entry points. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export async function isTrackerSnapshot(
	root: string,
	io: Pick<WorkspaceIO, "command">,
): Promise<boolean> {
	const branch = await io.command(["git", "branch", "--show-current"], root);
	const staged = await io.command(["git", "diff", "--cached", "--name-only", "--no-renames"], root);
	return branch === "tracker/state" && staged === ".beads/issues.jsonl";
}

/** Unhappy paths provide goals to an agent working with the user, rather than guessed rewrites. */
export function hookMigration(message: string): BeeswaxError {
	return new BeeswaxError(
		"migration_required",
		`${message} Ask an agent to run "beeswax migrate hooks" and walk through the migration with you.`,
		{ context: { nextCommand: "beeswax migrate hooks", requiresUser: true } },
	);
}

/** Plan only Beeswax's two native Git integrations; Git owns value parsing and precedence. */
// eslint-disable-next-line max-statements -- Verify native values and exact ownership before returning any write plan.
export async function planGitIntegration(
	options: {
		root: string;
		common: string;
		kind: "merge-driver" | "hooks-path";
		values: Record<string, string>;
		previous: Record<string, string> | undefined;
	},
	io: WorkspaceIO,
): Promise<{ path: string; before: string; after: string }> {
	const { root, common, kind, values, previous } = options;
	const path = join(common, "config");
	const before = await io.read(path);
	const section = gitIntegrationSection(kind, values);
	const prior = gitIntegrationSection(kind, previous ?? values);
	let after = replaceGitFence(before, { name: kind, path }, { current: section, previous: prior });
	let remaining = before;
	if (after !== undefined) {
		remaining = before.replace(prior, "").replace(section, "");
	}
	for (const [key, value] of Object.entries(values)) {
		const current = await io.exec(["git", "config", "--null", "--get-all", key], root);
		if (current.exitCode !== EXIT.success && current.exitCode !== EXIT.failure) {
			throw new BeeswaxError("git_configuration_failed", current.stderr || current.stdout);
		}
		const found = current.stdout.split("\0");
		if (current.exitCode === EXIT.failure) {
			found.length = FIRST;
		} else if (found.at(-SINGLE) === "") {
			found.pop();
		}
		if (
			found.length > SINGLE ||
			(found.length === SINGLE && found[FIRST] !== value && found[FIRST] !== previous?.[key])
		) {
			throw projectMigration(`Conflicting or duplicate ${key} in Git configuration for ${path}.`);
		}
		const oldValue = previous?.[key];
		const removed = removePriorGitLine(remaining, gitIntegrationHeading(kind), {
			key,
			value: oldValue,
		});
		if (removed !== remaining) {
			if (after !== undefined || found.length !== SINGLE) {
				throw projectMigration(
					`Unfamiliar or duplicate ${key} outside the Beeswax fence in ${path}.`,
				);
			}
			remaining = removed;
		} else if (after === undefined && found.length !== FIRST) {
			let adoption =
				"Review the existing hooksPath and exact standard Husky runtime before adoption.";
			if (kind === "merge-driver") {
				adoption =
					"Move the old .hive/beeswax/meta/merge-driver.local.json receipt to " +
					`${join(common, "beeswax/merge-driver.local.json")} and review its unchanged generation before retrying.`;
			}
			throw projectMigration(`Cannot establish ownership of ${key} in ${path}. ${adoption}`);
		}
	}
	if (after === undefined) {
		after = appendGitSection(remaining, section);
	}
	return { path, before, after };
}

function gitIntegrationSection(
	kind: "merge-driver" | "hooks-path",
	values: Record<string, string>,
): string {
	const heading = gitIntegrationHeading(kind);
	return [
		`# beeswax:begin ${kind} v1`,
		heading,
		...Object.entries(values).map(
			([key, value]) => `\t${key.slice(key.lastIndexOf(".") + SINGLE)} = ${gitConfigQuote(value)}`,
		),
		`# beeswax:end ${kind}`,
	].join("\n");
}

function gitConfigQuote(value: string): string {
	return `"${value
		.replaceAll("\\", String.raw`\\`)
		.replaceAll('"', String.raw`\"`)
		.replaceAll("\n", String.raw`\n`)
		.replaceAll("\t", String.raw`\t`)}"`;
}

function removePriorGitLine(
	contents: string,
	heading: string,
	entry: { key: string; value: string | undefined },
): string {
	const { key, value } = entry;
	if (value === undefined) {
		return contents;
	}
	const name = key.slice(key.lastIndexOf(".") + SINGLE);
	const quoted = gitConfigQuote(value);
	const escaped = quoted.slice(SINGLE, -SINGLE);
	let selected = false;
	let removed = false;
	return contents
		.split(/(?<=\n)/u)
		.filter((line) => {
			if (/^[ \t]*\[/u.test(line)) {
				selected = line.trimEnd() === heading;
			}
			if (
				selected &&
				(line === `\t${name} = ${value}\n` ||
					line === `\t${name} = ${quoted}\n` ||
					line === `\t${name} = ${escaped}\n`)
			) {
				if (removed) {
					throw projectMigration(`Duplicate generated Git key ${key}.`);
				}
				removed = true;
				return false;
			}
			return true;
		})
		.join("");
}

// eslint-disable-next-line max-statements -- Match exact versioned content while preserving surrounding bytes.
function replaceGitFence(
	contents: string,
	target: { name: string; path: string },
	versions: { current: string; previous: string },
): string | undefined {
	const { name, path } = target;
	const { current: section, previous } = versions;
	const starts = [...contents.matchAll(new RegExp(`^# beeswax:begin ${name}.*$`, "gmu"))];
	const ends = [...contents.matchAll(new RegExp(`^# beeswax:end ${name}.*$`, "gmu"))];
	if (starts.length === FIRST && ends.length === FIRST) {
		return undefined;
	}
	if (starts.length !== SINGLE || ends.length !== SINGLE) {
		throw projectMigration(`Duplicate or malformed Beeswax ${name} fence in ${path}.`);
	}
	const start = starts[FIRST]!.index;
	const end = ends[FIRST]!.index + ends[FIRST]![FIRST].length;
	const actual = contents.slice(start, end);
	if (actual !== section && actual !== previous) {
		throw projectMigration(
			`Edited or unsupported Beeswax ${name} fence in ${path}; observed ${JSON.stringify(actual)}, ` +
				`intended ${JSON.stringify(section)}.`,
		);
	}
	return `${contents.slice(FIRST, start)}${section}${contents.slice(end)}`;
}

function appendGitSection(contents: string, section: string): string {
	let separator = "";
	if (contents !== "" && !contents.endsWith("\n")) {
		separator = "\n";
	}
	return `${contents}${separator}${section}\n`;
}

function gitIntegrationHeading(kind: "merge-driver" | "hooks-path"): string {
	if (kind === "merge-driver") {
		return '[merge "hive-beads"]';
	}
	return "[core]";
}
