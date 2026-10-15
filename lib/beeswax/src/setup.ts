import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import type { HookAdapter, ProjectConfig } from "./config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Setup paths and inferred issue prefix.
import { basename, join, resolve } from "node:path";
import {
	configSchema,
	defaultProjectConfig,
	readProjectConfig,
	selectHookConfig,
	writeProjectConfig,
} from "./config.ts";
import { installHooks, installMergeDriver } from "./hooks.ts";
import { installTrackerHooks, verifyTrackerInitialization } from "./tracker-hooks.ts";
import {
	readProjectLock,
	requireProjectConfig,
	requireProjectGeneration,
	requireProjectVersion,
	verifyExecutable,
	writeProjectLock,
} from "./project.ts";
import type { WorkspaceIO } from "./services.ts";
import { bindCheckout } from "./binding.ts";
import { bootstrapHooks } from "./husky.ts";
import { z } from "zod";

const NONEMPTY = 1;

export const trackerSchema = z.enum(["init", "bootstrap", "adopt", "none"]);
export const integrationSchema = z.enum(["mise", "none"]);
export type TrackerMode = z.infer<typeof trackerSchema>;

export interface SetupFlags {
	/** Actor credited with native tracker changes. */
	actor?: string;
	/** Target checkout, defaulting to the calling directory. */
	repo?: string;
	/** Explicit creation, clone bootstrap, adoption or hooks-only setup. */
	tracker?: TrackerMode;
	/** Native Beads endpoint to adopt. */
	beadsDb?: string;
	/** Human owner for a newly initialized tracker. */
	owner?: string;
	/** New issue prefix; defaults to the repository directory name. */
	prefix?: string;
	/** Hook adapter; Husky is the default. */
	hooks?: HookAdapter;
	/** Optional environment integration, independent of application dependencies. */
	environment?: "mise" | "none";
	/** Generate Codex's local environment configuration. */
	codex?: boolean;
	/** Accept defaults without opening the wizard. */
	yes?: boolean;
	/** Installed executable used by generated Git adapters. */
	executable?: string;
	/** Configured pre-commit file receiving the validation section. */
	preCommit?: string;
	/** Explicit integration point for merge commits. */
	preMergeCommit?: string;
}

export interface SetupOptions {
	/** Actor credited with native tracker changes. */
	actor: string;
	/** Absolute checkout receiving project configuration. */
	repo: string;
	/** Explicit tracker operation. */
	tracker: TrackerMode;
	/** Selected absolute database, or empty for hook-only setup. */
	beadsDb: string;
	/** Human owner used only for fresh initialization. */
	owner: string;
	/** Issue prefix used only for fresh initialization. */
	prefix: string;
	/** Installed command wired into Git. */
	executable: string;
	/** Environment provider to configure. */
	environment: "mise" | "none";
	/** Whether local Codex configuration is generated. */
	codex: boolean;
	/** Hook adapter for Beeswax requirements; application hook bodies stay application-owned. */
	hooks: HookAdapter;
	/** One hook-file pair shared by application and tracker checkouts, plus its bootstrap preset. */
	config: ProjectConfig;
}

export interface SetupOperations {
	/** Perform one selected tracker operation using the same options as the wizard. */
	tracker: (options: SetupOptions) => Promise<string>;
}

export interface SetupDependencies extends WorkspaceIO {
	/** Native context read once by the application entry point. */
	context: {
		cwd: string;
		owner: string;
		actor: string;
		beadsDb: string;
		tty: boolean;
		executable: string;
	};
	/** Prompt only for options the caller did not provide. */
	wizard: (flags: SetupFlags, defaults: SetupOptions) => Promise<SetupFlags>;
	/** Injected native tracker operations. */
	operations: SetupOperations;
}

/** Resolve defaults before effects; headless and interactive callers share one setup operation. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function resolveSetup(
	flags: SetupFlags,
	json: boolean,
	deps: SetupDependencies,
): Promise<SetupOptions> {
	const cwd = resolve(flags.repo ?? deps.context.cwd);
	const root = await deps.command(["git", "rev-parse", "--show-toplevel"], cwd);
	const existing = await readProjectConfig(root, deps);
	const common = await deps.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const canonical = resolve(common, "..");
	const database =
		flags.beadsDb ??
		(deps.context.beadsDb || join(canonical, ".worktrees/tracker--state/.beads/beads.db"));
	const known = await deps.exists(database);
	let tracker: TrackerMode = "init";
	if (known) {
		tracker = "adopt";
	}
	const defaults: SetupOptions = {
		actor: deps.context.actor,
		repo: root,
		tracker,
		beadsDb: database,
		owner: deps.context.owner,
		prefix: basename(canonical)
			.toLowerCase()
			.replaceAll(/[^a-z\d-]/gu, "-")
			.replace(/^[^a-z]/u, "app-$&"),
		executable: deps.context.executable,
		environment: "none",
		codex: true,
		hooks: existing?.bootstrap.hooks ?? "husky",
		config: existing ?? defaultProjectConfig("husky"),
	};
	let selected = flags;
	if (!json && !flags.yes && deps.context.tty) {
		selected = { ...flags, ...(await deps.wizard(flags, defaults)) };
	} else if (flags.tracker === undefined && !known) {
		throw new BeeswaxError(
			"needs_input",
			"Choose --tracker init|bootstrap|adopt|none; see beeswax setup --help.",
			{
				context: { missingOptions: ["--tracker"] },
				exitCode: EXIT.usage,
			},
		);
	}
	return applyFlags(defaults, selected);
}

/** Apply resolved setup with a receipt identifying completed phases when an effect fails. */
// eslint-disable-next-line max-statements -- Keep this ordered CLI operation and its result together.
export async function setupRepository(options: SetupOptions, deps: SetupDependencies) {
	const completed: string[] = [];
	let database = "";
	try {
		const lock = await readProjectLock(options.repo, deps);
		if (lock) {
			requireProjectVersion(lock);
			requireProjectConfig(lock, options.config);
			requireProjectGeneration(lock, options.config);
		}
		if (options.tracker === "init") {
			await verifyTrackerInitialization(options.repo, options.config, deps);
		}
		await verifyExecutable(options.repo, options.executable, deps);
		await installLocalExcludes(options.repo, deps);
		completed.push("local_excludes");
		if (options.tracker !== "none") {
			database = await deps.operations.tracker(options);
			completed.push("tracker");
		}
		await writeProjectConfig(options.repo, options.config, deps);
		completed.push("configuration");
		await bindCheckout(options.repo, options.executable, deps);
		completed.push("local_binding");
		await installMergeDriver(options.repo, options.executable, deps);
		completed.push("merge_driver");
		const hooks = await installHooks(
			{
				root: options.repo,
				config: options.config,
			},
			deps,
		);
		if (database !== "") {
			await installTrackerHooks(
				{
					repository: options.repo,
					database,
					executable: options.executable,
					config: options.config,
				},
				deps,
			);
			completed.push("tracker_hooks");
		}
		await bootstrapHooks(options.repo, options.config.bootstrap.hooks, deps);
		completed.push("hooks");
		const lockfile = await writeProjectLock(options.repo, deps);
		completed.push("project_lock");
		return {
			ok: true,
			kind: "repository_setup",
			repository: options.repo,
			database,
			hooks,
			lockfile,
			completed,
		};
	} catch (error) {
		let context: Record<string, unknown> = {};
		if (error instanceof BeeswaxError) {
			({ context } = error);
		}
		throw new BeeswaxError("setup_failed", errorMessage(error), {
			context: {
				...context,
				repository: options.repo,
				completed,
				database,
			},
		});
	}
}

// --- Private functions ---

function applyFlags(defaults: SetupOptions, flags: SetupFlags): SetupOptions {
	const database = resolve(flags.beadsDb ?? defaults.beadsDb);
	let config = selectHookConfig(defaults.config, flags.hooks);
	config = {
		...config,
		hooks: {
			pre_commit: flags.preCommit ?? config.hooks.pre_commit,
			pre_merge_commit: flags.preMergeCommit ?? config.hooks.pre_merge_commit,
		},
	};
	return {
		...defaults,
		actor: z
			.string()
			.trim()
			.min(NONEMPTY)
			.parse(flags.actor ?? defaults.actor),
		tracker: flags.tracker ?? defaults.tracker,
		beadsDb: database,
		owner: z
			.string()
			.trim()
			.min(NONEMPTY)
			.parse(flags.owner ?? defaults.owner),
		prefix: z
			.string()
			.regex(/^[a-z][a-z\d-]*$/u)
			.parse(flags.prefix ?? defaults.prefix),
		executable: z
			.string()
			.trim()
			.min(NONEMPTY)
			.parse(flags.executable ?? defaults.executable),
		environment: flags.environment ?? defaults.environment,
		codex: flags.codex ?? defaults.codex,
		hooks: flags.hooks ?? defaults.hooks,
		config: configSchema.parse(config),
	};
}

/** Local runtime selections and nested worktrees do not belong to application history. */
async function installLocalExcludes(root: string, io: WorkspaceIO): Promise<void> {
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const path = join(common, "info/exclude");
	const contents = await io.read(path);
	const present = new Set(contents.split("\n"));
	const missing = ["/.worktrees/", "/mise.local.toml", "/.codex/config.toml"].filter(
		(entry) => !present.has(entry),
	);
	if (missing.length >= NONEMPTY) {
		await io.write(path, `${contents.trimEnd()}\n${missing.join("\n")}\n`);
	}
}
