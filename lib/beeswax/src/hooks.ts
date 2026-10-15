/* eslint-disable no-await-in-loop -- Preflight all configured files before ordered generation effects. */
import { BeeswaxError, EXIT } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve declared hook files and Git metadata.
import { join, resolve } from "node:path";
import { readMergeReceipt, writeMergeReceipt } from "./receipts.ts";
import type { ProjectConfig } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { hookSection } from "./templates.ts";
import { projectMigration } from "./project.ts";

export { hookSection } from "./templates.ts";

const NOT_FOUND = -1;
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
	if (finish <= start || contents.slice(start, finish) !== hookSection) {
		throw hookMigration("The Beeswax section was edited or has an unsupported generator revision.");
	}
	return contents;
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
	const values = {
		"merge.hive-beads.name": "Hive Beads JSONL merge driver",
		"merge.hive-beads.driver": `${shellQuote(executable)} git merge "%O" "%A" "%B"`,
		"merge.hive-beads.recursive": "hive-beads",
	};
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const receipt = await readMergeReceipt(common, io);
	for (const [key, value] of Object.entries(values)) {
		const existing = await io.exec(["git", "config", "--get", key], root);
		if (existing.exitCode !== EXIT.success && existing.exitCode !== EXIT.failure) {
			throw new BeeswaxError("git_configuration_failed", existing.stderr || existing.stdout);
		}
		const current = existing.stdout.trim();
		if (current !== "" && current !== value && current !== receipt?.config[key]) {
			throw projectMigration(`Existing ${key} is not an unchanged Beeswax generation.`);
		}
	}
	const path = join(root, ".gitattributes");
	const contents = await io.read(path);
	const entry = ".beads/issues.jsonl text eol=lf merge=hive-beads";
	const lines = contents.split("\n");
	const current = lines.findIndex((line) => /^\.beads\/issues\.jsonl\s/u.test(line));
	if (current !== NOT_FOUND && lines[current] !== entry && lines[current] !== receipt?.attribute) {
		throw projectMigration(
			"Existing .beads/issues.jsonl attributes require an agreed integration.",
		);
	}
	for (const [key, value] of Object.entries(values)) {
		await io.command(["git", "config", "--local", key, value], root);
	}
	if (current === NOT_FOUND) {
		let prefix = contents.trimEnd();
		if (prefix !== "") {
			prefix += "\n";
		}
		await io.write(path, `${prefix}${entry}\n`);
	} else {
		lines[current] = entry;
		await io.write(path, `${lines.join("\n").trimEnd()}\n`);
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
