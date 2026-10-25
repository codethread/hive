/* eslint-disable import/max-dependencies -- Setup composes repository adapters. */
import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import type { HookAdapter, OnboardingFlags, ProjectConfig } from "./config.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Setup paths and inferred issue prefix.
import { basename, join, resolve } from "node:path";
import {
	configSchema,
	defaultProjectConfig,
	readProjectConfig,
	selectHookConfig,
	selectOnboardingConfig,
	writeProjectConfig,
} from "./config.ts";
import { installHooks, installMergeDriver } from "./hooks.ts";
import { installTrackerHooks, verifyTrackerInitialization } from "./tracker-hooks.ts";
import {
	installWorkflowSkill,
	planWorkflowSkill,
	preflightWorkflowSkill,
} from "./workflow-skill.ts";
import {
	readProjectLock,
	requireProjectConfig,
	requireProjectGeneration,
	requireProjectVersion,
	verifyExecutable,
	writeProjectLock,
} from "./project.ts";
import type { BeadsService } from "@hive/beads";
import type { BvRecipeFiles } from "./bv-recipes.ts";
import type { OnboardingConfig } from "./onboarding.ts";
import type { WorkspaceIO } from "./services.ts";
import { applyOnboarding } from "./onboarding.ts";
import { bindCheckout } from "./binding.ts";
import { bootstrapHooks } from "./husky.ts";
import { installBvRecipes } from "./bv-recipes.ts";
import { setupReadiness } from "./readiness.ts";
import { trackerRoot } from "./beads/environment.ts";
import { z } from "zod";

const NONEMPTY = 1;

export const trackerSchema = z.enum(["init", "bootstrap", "adopt", "none"]);
export const integrationSchema = z.enum(["mise", "none"]);
export type TrackerMode = z.infer<typeof trackerSchema>;

export interface SetupFlags extends OnboardingFlags {
	/** Actor credited with native tracker changes. */
	actor?: string;
	/** Target checkout, defaulting to the calling directory. */
	repo?: string;
	/** Explicit creation, clone bootstrap, adoption or setup without tracker operations. */
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
	/** Generate Codex's local tracker environment configuration. */
	codex?: boolean;
	/** Accept defaults without opening the wizard. */
	yes?: boolean;
	/** Installed executable used by generated Git adapters. */
	executable?: string;
	/** Configured pre-commit file receiving the validation section. */
	preCommit?: string;
	/** Explicit integration point for merge commits. */
	preMergeCommit?: string;
	/** Explicit request for the curated project workflow skill. */
	installWorkflowSkill?: boolean;
}

export interface SetupOptions {
	/** Actor credited with native tracker changes. */
	actor: string;
	/** Absolute checkout receiving project configuration. */
	repo: string;
	/** Explicit tracker operation. */
	tracker: TrackerMode;
	/** Selected absolute database; unused when tracker is none. */
	beadsDb: string;
	/** Human owner used only for fresh initialization. */
	owner: string;
	/** Issue prefix used only for fresh initialization. */
	prefix: string;
	/** Installed command wired into Git. */
	executable: string;
	/** Environment provider to configure. */
	environment: "mise" | "none";
	/** Whether Codex's local tracker environment is generated. */
	codex: boolean;
	/** Hook adapter for Beeswax requirements; application hook bodies stay application-owned. */
	hooks: HookAdapter;
	/** Shared Git hook files, bootstrap preset and optional harness onboarding. */
	config: ProjectConfig;
	/** Optional targets for this setup invocation only. */
	workflowSkill: ReturnType<typeof planWorkflowSkill>;
}

export interface SetupOperations {
	/** Check init conflicts before any setup files are written. */
	preflight: (options: SetupOptions) => Promise<void>;
	/** Perform one selected tracker operation using the same options as the wizard. */
	tracker: (options: SetupOptions) => Promise<string>;
}

export interface SetupDependencies extends WorkspaceIO {
	/** Recipe file adapter composed at the application boundary. */
	bvRecipeFiles: BvRecipeFiles;
	/** Native tracker configuration used only during explicit setup/update/sync. */
	nativeBeads: Pick<BeadsService, "config">;
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
	/** Select repository-local harness adapters without repeating tracker setup. */
	onboardingWizard: (
		flags: OnboardingFlags,
		current: OnboardingConfig | undefined,
	) => Promise<OnboardingFlags>;
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
		workflowSkill: undefined,
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
	const bvRecipes: string[] = [];
	let database = "";
	try {
		const lock = await readProjectLock(options.repo, deps);
		if (lock) {
			requireProjectVersion(lock);
			requireProjectConfig(lock, options.config);
			requireProjectGeneration(lock, options.config);
		}
		if (options.workflowSkill) {
			await preflightWorkflowSkill(options.repo, options.workflowSkill, deps);
		}
		if (options.tracker === "init") {
			await deps.operations.preflight(options);
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
		const checkouts = [options.repo];
		if (database !== "") {
			checkouts.push(trackerRoot(database));
		}
		bvRecipes.push(...(await installBvRecipes(checkouts, deps.bvRecipeFiles)));
		completed.push("bv_recipes");
		await bootstrapHooks(options.repo, options.config.bootstrap.hooks, deps);
		completed.push("hooks");
		const onboarding = await applyOnboarding(options.repo, options.config.onboarding, deps);
		if (onboarding.length >= NONEMPTY) {
			completed.push("onboarding");
		}
		const lockfile = await writeProjectLock(options.repo, deps);
		completed.push("project_lock");
		const readiness = await setupReadiness(options, database, deps);
		const workflowSkill =
			options.workflowSkill &&
			(await installWorkflowSkill(options.repo, options.workflowSkill, deps));
		if (workflowSkill) {
			completed.push("workflow_skill");
		}
		return {
			ok: true,
			kind: "repository_setup",
			repository: options.repo,
			database,
			hooks,
			bvRecipes,
			lockfile,
			completed,
			readiness,
			workflowSkill,
		};
	} catch (error) {
		let context: Record<string, unknown> = {};
		let cause = "execution_failed";
		if (error instanceof BeeswaxError) {
			({ context } = error);
			cause = error.reason;
		}
		throw new BeeswaxError("setup_failed", errorMessage(error), {
			context: {
				...context,
				cause,
				repository: options.repo,
				completed,
				bvRecipes: context.bvRecipes ?? bvRecipes,
				database: database || context.database || "",
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
	config = configSchema.parse(selectOnboardingConfig(config, flags));
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
		config,
		workflowSkill: planWorkflowSkill(flags.installWorkflowSkill ?? false, config.onboarding),
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
