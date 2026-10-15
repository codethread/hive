/* eslint-disable import/max-dependencies -- This CLI composes its command groups and public dependency contract. */
import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import { Command, CommanderError, Option } from "commander";
import type { SetupDependencies, SetupFlags } from "./setup.ts";
import { addBeads, addMigration, addProjectCommands, addSkills } from "./commands.ts";
import { configSchema, hookAdapterSchema } from "./config.ts";
import { integrationSchema, resolveSetup, setupRepository, trackerSchema } from "./setup.ts";
import { isTrackerSnapshot, validateTrackerHook } from "./hooks.ts";
import type { MergePaths } from "./git/merge.ts";
import type { MergeResult } from "./git/merge-core.ts";
import type { Selection } from "./beads/setup.ts";
import type { SkillProvider } from "skills-handler";
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
	/** Native tracker operations behind the CLI seam. */
	beads: {
		setup: (repo: string, selection: Selection, flags: SetupFlags) => Promise<string>;
		bootstrap: (repo: string, flags: SetupFlags) => Promise<string>;
		initialize: (repo: string, flags: SetupFlags) => Promise<unknown>;
		environment: (repo: string, database?: string) => Promise<{ BEADS_DB: string }>;
		sync: (repo: string, database?: string, actor?: string) => Promise<void>;
		automatic: (repo: string, source: string) => Promise<string | undefined>;
		sessionStart: (input: unknown, file: string) => Promise<void>;
	};
	/** Git file-protocol operations use the same implementation as hooks. */
	git: {
		merge: (paths: MergePaths) => Promise<MergeResult>;
		validate: (repo: string) => Promise<void>;
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
			"\nStart: beeswax setup --help\nAgents: provide explicit flags; JSON and non-TTY runs never prompt.\n",
		);
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
				result,
			});
		});
	setupOptions(
		program
			.command("setup")
			.description("Configure a repository through a wizard or explicit flags"),
	)
		.addHelpText(
			"after",
			"\nFirst tracker with versioned hooks (headless; run in the canonical checkout):\n" +
				"  beeswax setup --tracker none --hooks husky --environment none --no-codex --yes --json\n" +
				"  # Review and commit the generated project contract and hook sections before init.\n" +
				"  beeswax setup --tracker init --prefix app --owner operator --hooks husky " +
				"--environment none --no-codex --yes --json\n" +
				"Init checks configured versioned hooks in the canonical checkout's HEAD before setup changes.\n" +
				"Paths under .git/ use shared Git metadata and need no commit.\n" +
				"Published tracker history: --tracker bootstrap. Existing database: --tracker adopt --beads-db PATH.\n" +
				"No tracker changes: --tracker none. Remote publication is a separate beads sync operation.\n",
		)
		.action(async function setup(this: Command) {
			const options = await resolveSetup(
				this.optsWithGlobals<Options>(),
				Boolean(program.opts<Options>().json),
				deps,
			);
			emit(await setupRepository(options, deps));
		});
	program
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
	const git = program.command("git").description("Git's merge and staged-snapshot protocols");
	git
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
	git
		.command("validate-staged")
		.description("Validate the staged tracker JSONL, independent of the working file")
		.action(async function validate(this: Command) {
			await deps.git.validate(await checkout(this.optsWithGlobals<Options>(), deps));
			if (program.opts<Options>().json) {
				emit({ ok: true, kind: "snapshot_valid" });
			}
		});
	const hooks = program
		.command("hooks")
		.description("Tracker snapshot validation and classification for Git hooks");
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
	addSkills(program, deps, emit);
	addMigration(program, deps, emit);
	addProjectCommands(program, deps, emit);
	return program;
}

export function setupOptions(command: Command): Command {
	return command
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
		.option("--pre-commit <path>", "Commit hook file; saved in .hive/beeswax/config.toml")
		.option("--pre-merge-commit <path>", "Merge hook file; saved in .hive/beeswax/config.toml")
		.option("-y, --yes", "Accept inferred defaults; never prompt");
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
