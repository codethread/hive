/* eslint-disable import/max-dependencies -- This CLI composes its command groups and public dependency contract. */
import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import { Command, CommanderError, Option } from "commander";
import type { SetupDependencies, SetupFlags } from "./setup.ts";
import {
	addBeads,
	addMigration,
	addProjectCommands,
	addSessionStart,
	addSkills,
} from "./commands.ts";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@hive/shared/changelog";
import { configSchema, hookAdapterSchema } from "./config.ts";
import { integrationSchema, resolveSetup, setupRepository, trackerSchema } from "./setup.ts";
import { isTrackerSnapshot, validateTrackerHook } from "./hooks.ts";
import { trackerAlertObservationSchema, trackerRecoveryHandoffSchema } from "./beads/alerts.ts";
import type { MergePaths } from "./git/merge.ts";
import type { MergeResult } from "./git/merge-core.ts";
import type { PackingResult } from "./git/pack.ts";
import type { Selection } from "./beads/setup.ts";
import type { SkillProvider } from "skills-handler";
import type { TrackerAlertObservation } from "./beads/alerts.ts";
import type { TrackerRecovery } from "./beads/alerts-publication.ts";
import { addAlertHooks } from "./harness-alerts.ts";
import { addPrime } from "./prime.ts";
import changelog from "../changelog.json";
import { lockSchema } from "./project.ts";
import { version } from "../package.json";
import { z } from "zod";

const MINIMUM_ITEMS = 1;

export interface Options extends SetupFlags {
	/** Emit one success or error document and never prompt. */
	json?: boolean;
	/** Configured checkout to inherit during worktree preparation. */
	source?: string;
	/** Harness-provided output file for Claude's environment exports. */
	environmentFile?: string;
}

export interface Dependencies extends SetupDependencies {
	/** Check whether a command name resolves on PATH from cwd. */
	commandAvailable: (name: string, cwd: string) => boolean;
	/** Read version-matched release metadata without repository discovery. */
	installationInfo: () => Promise<object>;
	/** Default destination for explicitly installed CLI artifacts. */
	binDirectory: string;
	/** Install named built artifacts through the native filesystem adapter. */
	installArtifacts: (source: string, destination: string, names: string[]) => Promise<string[]>;
	/** Terminal result stream. */
	stdout: (text: string) => void;
	/** Human diagnostics stream, kept silent in JSON mode. */
	stderr: (text: string) => void;
	/** Read a native harness hook's JSON payload. */
	stdin: () => Promise<string>;
	/** Source checkout for automatic environment adoption. */
	source: string;
	/** Claude's environment export destination, if supplied by the harness. */
	environmentFile: string;
	/** Bundled, version-matched agent instruction catalogue. */
	skills: SkillProvider;
	/** User-local observation receipt destination, independent of tracker files. */
	alertReceiptPath: (database: string, session: { harness: string; id: string }) => string;
	/** Native tracker operations behind the CLI seam. */
	beads: {
		setup: (repo: string, selection: Selection, flags: SetupFlags) => Promise<string>;
		bootstrap: (repo: string, flags: SetupFlags) => Promise<string>;
		initialize: (repo: string, flags: SetupFlags) => Promise<unknown>;
		environment: (repo: string, database?: string) => Promise<{ BEADS_DB: string }>;
		sync: (
			repo: string,
			database?: string,
			options?: { actor: string; recovery?: TrackerRecovery },
		) => Promise<void>;
		/** Read independent alert state without native Beads; undefined means no selected endpoint. */
		alertStatus: (repo: string, database?: string) => Promise<TrackerAlertObservation | undefined>;
		/** Wait up to the requested seconds for a receipt change without native Beads. */
		alertWait: (
			repo: string,
			seconds: number,
			database?: string,
		) => Promise<TrackerAlertObservation>;
		automatic: (repo: string, source: string) => Promise<string | undefined>;
		sessionStart: (input: unknown, file: string) => Promise<void>;
	};
	/** Native Git operations and the file protocols shared with hooks. */
	git: {
		merge: (paths: MergePaths) => Promise<MergeResult>;
		validate: (repo: string) => Promise<void>;
		pack: (repo: string) => Promise<PackingResult>;
	};
}

/** One boundary formats failures and keeps headless JSON invocations free of terminal output. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function runCli(argv: readonly string[], deps: Dependencies): Promise<number> {
	const json = argv.includes("--json");
	let status: number = EXIT.success;
	const emit = (value: object, text?: string) => {
		let output = text ?? JSON.stringify(value);
		if (json) {
			output = JSON.stringify(value);
		}
		deps.stdout(`${output}\n`);
	};
	try {
		const program = createProgram(deps, emit, (code) => {
			status = code;
		});
		await program.parseAsync([...argv], { from: "user" });
		return status;
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === EXIT.success) {
			return EXIT.success;
		}
		const failure = describeError(error);
		if (json) {
			deps.stdout(`${JSON.stringify(failure.document)}\n`);
		} else {
			deps.stderr(`${failure.document.message}\n`);
		}
		return failure.exitCode;
	}
}

// --- Private functions ---

// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
function createProgram(
	deps: Dependencies,
	emit: (value: object, text?: string) => void,
	setStatus: (code: number) => void,
): Command {
	const program = new Command()
		.name("beeswax")
		.version(version)
		.description("Repository setup, Beads tracker plumbing and Git hook adapters")
		.option("--json", "Emit one result document; never open prompts")
		.option("--repo <directory>", "Target checkout", deps.context.cwd)
		.option("--actor <identity>", "Tracker mutation actor", deps.context.actor)
		.configureOutput({ writeOut: deps.stdout, writeErr: () => {} })
		.exitOverride()
		.addHelpText(
			"after",
			"\nStart: beeswax setup --help. Agent decisions: beeswax skills get repository-setup.\n" +
				"JSON commands emit one success/error document with silent stderr; help stays text.\n",
		);

	program
		.command("changelog")
		.description(
			"Read embedded history offline; defaults to the latest recorded release at or below this executable version",
		)
		.summary("Read offline release history")
		.option("--since <version>", "Releases newer than this stable version (exclusive)")
		.option("--release <version>", "Read one exact recorded release; cannot combine with --since")
		.option("--limit <count>", "Changes per page (1–100, default 20)")
		.option("--offset <count>", "Skip matching changes (default 0)")
		.option("--schema", "Print the successful JSON response schema")
		.option("--json", "Emit one JSON document with silent stderr")
		.action(function changelogCommand(this: Command) {
			const options = this.optsWithGlobals();
			if (options["schema"] === true) {
				deps.stdout(
					`${JSON.stringify({ ok: true, kind: "changelog_schema", schema: changelogSchema() })}\n`,
				);
				return;
			}
			const page = queryChangelog(
				{ tool: "beeswax", version },
				changelogHistorySchema.parse(changelog),
				changelogQuerySchema.parse(options),
			);
			let output = renderChangelog(page);
			if (options["json"] === true) {
				output = `${JSON.stringify(page)}\n`;
			}
			deps.stdout(output);
		});
	const system = program
		.command("system")
		.description("Automation adapters for setup scripts, Git hooks and harness callbacks");
	addPrime(program, emit);
	program
		.command("info")
		.description("Show installed version, release revision and source retrieval route")
		.addHelpText(
			"after",
			`
Reads release metadata beside the executable in known package/release layouts.
The JSON result includes version, executable, revision and metadata path; absent
metadata leaves revision and metadata null. Source status is not_installed.
Use source.url or source.archive to retrieve the recorded revision, or the release
tag when revision metadata is unavailable. This command does not download source
or search local checkouts.
`,
		)
		.action(async () => {
			emit(await deps.installationInfo());
		});
	program
		.command("schema")
		.description("Print JSON schemas for project configuration, lock and result envelopes")
		.action(() => {
			const success = z.object({ ok: z.literal(true), kind: z.string() }).passthrough();
			const failure = z
				.object({ ok: z.literal(false), kind: z.string(), reason: z.string(), message: z.string() })
				.passthrough();
			const result = z.toJSONSchema(z.union([success, failure]));
			emit({
				ok: true,
				kind: "schemas",
				configuration: z.toJSONSchema(configSchema),
				projectLock: z.toJSONSchema(lockSchema),
				trackerAlert: z.toJSONSchema(trackerAlertObservationSchema),
				trackerRecoveryHandoff: z.toJSONSchema(trackerRecoveryHandoffSchema),
				result,
			});
		});
	setupOptions(
		program
			.command("setup")
			.description("Configure a repository through a wizard or explicit flags")
			.option(
				"--install-workflow-skill",
				"Install the optional hive skill for selected harnesses; see prerequisites below",
			),
	)
		.addHelpText(
			"after",
			"\nJSON, non-TTY and --yes runs never prompt. Without a known database, choose --tracker explicitly.\n" +
				"Adopt uses the selected database; bootstrap imports accepted origin/tracker/state history only\n" +
				"when its database is absent. Init creates the first tracker; none skips tracker changes.\n" +
				"\nFirst tracker with versioned hooks (run in the canonical checkout):\n" +
				"  beeswax setup --tracker none --hooks husky --environment none --no-codex --yes --json\n" +
				"  # Review and commit the generated project contract and hook sections before init.\n" +
				"  beeswax setup --tracker init --prefix app --owner operator --hooks husky " +
				"--environment none --no-codex --yes --json\n" +
				"Init checks configured versioned hooks, existing stores and inherited exports before setup writes.\n" +
				"Paths under .git/ use shared Git metadata and need no commit.\n" +
				"First snapshot and upstream: beeswax skills file repository-setup references/publication.md\n" +
				"\nHooks: husky bootstraps the bundled runner; git retains Git's default hook lookup.\n" +
				"None skips framework bootstrap but still installs validation sections. Custom frameworks must invoke\n" +
				"the --pre-commit/--pre-merge-commit files. Inspect formats with beeswax schema.\n" +
				"Setup stays local; beads sync publishes. The readiness receipt reports configured artifacts,\n" +
				"effective Honeycomb policy and next actions; execution remains not_verified. Review those\n" +
				"actions through beeswax skills get repository-setup before declaring onboarding complete.\n" +
				"Failures retain completed phases and any trackerEffects, including observed checkout/database\n" +
				"artifacts. Inspect these and the reported next action before retrying; setup is not rolled back.\n" +
				"\nWorkflow skill: --install-workflow-skill opts in for this setup only; --yes alone does not.\n" +
				"Requires Node >=22.20.0, npm/npx and network access. Uses skills@1.7.2 and the resolved\n" +
				"--harness selection: claude maps to claude-code; codex and pi keep their names.\n" +
				"Source: https://github.com/codethread/hive/tree/main/lib/beeswax/skills/hive (only skill hive).\n" +
				"Before setup writes, any entry at .agents/skills/hive or the selected Claude target\n" +
				".claude/skills/hive stops installation. Omit the flag to retain it; review updates manually.\n" +
				"Installation runs last. Its receipt confirms installer results and observed paths, not harness\n" +
				"loading. On failure, inspect installer diagnostics and possible partial files before retrying.\n" +
				"The install request is not saved; prime, hooks, sync and update never install or update the skill.\n",
		)
		.action(async function setup(this: Command) {
			const options = await resolveSetup(
				this.optsWithGlobals<Options>(),
				Boolean(program.opts<Options>().json),
				deps,
			);
			emit(await setupRepository(options, deps));
		});
	system
		.command("prepare")
		.description("Inherit an existing worktree tracker environment")
		.option("--source <directory>", "Checkout supplying an existing selection", deps.source)
		.action(async function prepare(this: Command) {
			const options = this.optsWithGlobals<Options>();
			const root = await checkout(options, deps);
			const database = await deps.beads.automatic(root, options.source ?? root);
			emit({ ok: true, kind: "checkout_prepared", repository: root, database });
		});
	addBeads(program, deps, emit);
	program
		.command("artifacts")
		.description("Install explicitly selected built CLI artifacts")
		.command("install <names...>")
		.option("--source <directory>", "Built artifact directory", "dist")
		.option("--directory <path>", "Install destination", deps.binDirectory)
		.action(async function install(this: Command, names: string[]) {
			const options = this.opts<{ source: string; directory: string }>();
			const selected = z
				.array(z.string().regex(/^[a-z][a-z\d-]*$/u))
				.min(MINIMUM_ITEMS)
				.parse(names);
			const artifacts = await deps.installArtifacts(options.source, options.directory, [
				...new Set(selected),
			]);
			emit({ ok: true, kind: "artifacts_installed", artifacts });
		});
	const git = program.command("git").description("Git storage maintenance");
	git
		.command("pack")
		.description("Pack Git objects while preserving recovery history")
		.addHelpText(
			"after",
			"\nSelect a checkout with --repo (default: current directory). In the default layout, packing\n" +
				"covers its common Git object store, shared by all linked worktrees, including application\n" +
				"and tracker branches. Inherited native Git environment variables can redirect repository\n" +
				"and object-directory selection (for example, GIT_DIR and GIT_OBJECT_DIRECTORY).\n" +
				"BEADS_DB does not select its scope.\n" +
				"\nRetains reachable and unreachable objects; removes only redundant physical copies.\n" +
				"No object or reflog expiry, history rewrite, remote access, database operations or backup deletion.\n" +
				"Keep other repack, gc, prune and maintenance jobs idle until it finishes; this command\n" +
				"does not lock them out. Allow temporary extra disk space; savings are not guaranteed.\n" +
				"\nWith --json, the git_packed receipt identifies repository and commonDirectory. commonDirectory\n" +
				"reports Git's common metadata directory, not the effective object store under redirection.\n" +
				"The before/after observations contain looseObjects, packedObjects, packs, looseKiB and packedKiB.\n" +
				"Sizes are reported by Git in KiB, not exact byte savings. Concurrent writes can affect\n" +
				"observations; before/after is not an atomic snapshot.\n",
		)
		.action(async function pack(this: Command) {
			const result = await deps.git.pack(await checkout(this.optsWithGlobals<Options>(), deps));
			emit({ ok: true, kind: "git_packed", ...result });
		});
	const systemGit = system
		.command("git")
		.description("Snapshot merge and staged-validation protocols");
	systemGit
		.command("merge <ancestor> <current> <other>")
		.description(
			"Three-way merge; overwrites current, exits 1 for conflicts and 2 for invalid input",
		)
		.action(async (ancestor: string, current: string, other: string) => {
			const result = await deps.git.merge({ ancestor, current, other });
			if (result.kind === "invalid") {
				throw new BeeswaxError("invalid_snapshot", result.message, { exitCode: EXIT.usage });
			}
			if (result.kind === "conflicted") {
				setStatus(EXIT.failure);
				emit(
					{
						ok: false,
						kind: "merge",
						reason: "conflict",
						message: "Snapshot changes conflict",
						issueIds: result.issueIds,
					},
					`Conflicts: ${result.issueIds.join(", ")}`,
				);
			} else if (program.opts<Options>().json) {
				emit({ ok: true, kind: "merged" });
			}
		});
	systemGit
		.command("validate-staged")
		.description("Validate the staged tracker JSONL, independent of the working file")
		.action(async function validate(this: Command) {
			await deps.git.validate(await checkout(this.optsWithGlobals<Options>(), deps));
			if (program.opts<Options>().json) {
				emit({ ok: true, kind: "snapshot_valid" });
			}
		});
	const hooks = system
		.command("hooks")
		.description("Tracker snapshot validation and classification for Git hooks");
	addAlertHooks(system, {
		...deps,
		receiptPath: deps.alertReceiptPath,
		observe: (cwd) => deps.beads.alertStatus(cwd),
	});
	hooks
		.command("validate")
		.description("Validate a staged tracker snapshot; ordinary application changes are untouched")
		.action(async function validateHook(this: Command) {
			const root = await checkout(this.optsWithGlobals<Options>(), deps);
			const validated = await validateTrackerHook(root, deps, () => deps.git.validate(root));
			if (program.opts<Options>().json) {
				emit({ ok: true, kind: "hook_validation", trackerSnapshot: validated });
			}
		});
	hooks
		.command("is-tracker-snapshot")
		.description("Predicate: exit 0 for a snapshot-only tracker commit, 1 otherwise")
		.action(async function predicate(this: Command) {
			const matched = await isTrackerSnapshot(
				await checkout(this.optsWithGlobals<Options>(), deps),
				deps,
			);
			if (!matched) {
				setStatus(EXIT.failure);
			}
			if (program.opts<Options>().json) {
				emit({ ok: true, kind: "tracker_snapshot_match", matched });
			}
		});
	addSessionStart(system.command("beads").description("Tracker environment callbacks"), deps, emit);
	addSkills(program, deps, emit);
	addMigration(program, deps, emit);
	addProjectCommands(program, deps, emit);
	return program;
}

export function setupOptions(command: Command): Command {
	return onboardingOptions(command)
		.addOption(
			new Option("--tracker <mode>", "init, bootstrap, adopt or none").choices(
				trackerSchema.options,
			),
		)
		.option(
			"--beads-db <path>",
			"Selected existing tracker database; defaults to BEADS_DB/canonical tracker",
		)
		.option("--prefix <prefix>", "Issue prefix for init; defaults to repository directory name")
		.option("--owner <human>", "Accountable owner for init; defaults to current OS account")
		.addOption(
			new Option(
				"--hooks <adapter>",
				"Bootstrap preset; default configured adapter or husky",
			).choices(hookAdapterSchema.options),
		)
		.addOption(
			new Option("--environment <provider>", "Shell integration; default none").choices(
				integrationSchema.options,
			),
		)
		.option("--codex", "Write Codex's local tracker environment (default)")
		.option("--no-codex", "Skip Codex environment configuration")
		.option(
			"--executable <path>",
			"Absolute installed CLI; default running binary or ~/.local/bin/beeswax",
		)
		.option("--pre-commit <path>", "POSIX-shell commit hook; saved in project configuration")
		.option("--pre-merge-commit <path>", "POSIX-shell merge hook; saved in project configuration")
		.option("-y, --yes", "Accept inferred defaults; never prompt");
}

export function onboardingOptions(command: Command): Command {
	return command
		.option(
			"--harness <name>",
			"Repo-local onboarding: claude, codex, pi or none; repeatable",
			collectOptions,
		)
		.option("--include <tool>", "Add guidance to prime's default set; repeatable", collectOptions)
		.option("--exclude <tool>", "Remove guidance after inclusion; repeatable", collectOptions)
		.addHelpText(
			"after",
			"\nOnboarding adapters are generated only in this repository. Repeat --harness to select several;\n" +
				"use --harness none alone to remove recognized adapters. Omitted headless options retain saved choices.\n" +
				"Includes add to prime's defaults; excludes win. See beeswax prime --help for tool names.\n" +
				"Ambiguous onboarding stops with an agent handoff: beeswax migrate setup.\n" +
				"Codex requires project trust and /hooks review; Pi requires project trust.\n",
		);
}

export async function checkout(options: Options, deps: Dependencies): Promise<string> {
	return await deps.command(
		["git", "rev-parse", "--show-toplevel"],
		options.repo ?? deps.context.cwd,
	);
}

function describeError(error: unknown) {
	let failure = new BeeswaxError("execution_failed", errorMessage(error));
	if (error instanceof BeeswaxError) {
		failure = error;
	}
	if (error instanceof CommanderError) {
		failure = new BeeswaxError("usage", error.message, { exitCode: EXIT.usage });
	}
	return {
		exitCode: failure.exitCode,
		document: {
			ok: false,
			kind: "error",
			reason: failure.reason,
			message: failure.message,
			...failure.context,
		},
	};
}

function collectOptions(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}
