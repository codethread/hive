import { BeeswaxError, EXIT } from "./errors.ts";
import type { Dependencies, Options } from "./cli.ts";
import { checkout, onboardingOptions, setupOptions } from "./cli.ts";
import { integrationSchema, resolveSetup } from "./setup.ts";
import {
	projectMigration,
	readProjectLock,
	requireProjectConfig,
	requireProjectGeneration,
	writeProjectLock,
} from "./project.ts";
import type { Command } from "commander";
import { Option } from "commander";
import type { Selection } from "./beads/setup.ts";
import { readProjectConfig } from "./config.ts";
import { synchronizeProject } from "./synchronize.ts";

export function addBeads(
	program: Command,
	deps: Dependencies,
	emit: (value: object) => void,
): void {
	const beads = program
		.command("beads")
		.description("Configure, inspect or publish the selected native tracker");
	beads
		.command("env")
		.option("--beads-db <path>", "Override BEADS_DB")
		.description("Report the selected tracker environment")
		.action(async function environment(this: Command) {
			const options = this.optsWithGlobals<Options>();
			emit({
				ok: true,
				kind: "environment",
				environment: await deps.beads.environment(await checkout(options, deps), options.beadsDb),
			});
		});
	const setup = beads
		.command("setup")
		.description("Adopt one existing database or inherit a configured checkout");
	setup
		.option("--beads-db <path>", "Existing database")
		.option("--source <directory>", "Configured source checkout")
		.addOption(
			new Option("--environment <provider>", "Shell integration")
				.choices(integrationSchema.options)
				.default("mise"),
		)
		.option("--no-codex", "Skip Codex environment configuration")
		.action(async function adopt(this: Command) {
			const options = this.optsWithGlobals<Options>();
			if (Boolean(options.beadsDb) === Boolean(options.source)) {
				throw new BeeswaxError("usage", "Select exactly one of --beads-db or --source.", {
					exitCode: EXIT.usage,
				});
			}
			let selection: Selection = { kind: "source", root: options.source ?? "" };
			if (options.beadsDb) {
				selection = { kind: "database", database: options.beadsDb };
			}
			const database = await deps.beads.setup(await checkout(options, deps), selection, options);
			emit({ ok: true, kind: "tracker_configured", database });
		});
	for (const entry of [
		{
			name: "bootstrap",
			description: "Materialize accepted origin/tracker/state history",
			kind: "tracker_bootstrapped",
		},
		{
			name: "init",
			description: "Create the first dedicated tracker explicitly",
			kind: "tracker_initialized",
		},
	] as const) {
		setupOptions(beads.command(entry.name).description(entry.description)).action(
			async function materialize(this: Command) {
				const flags = this.optsWithGlobals<Options>();
				const options = await resolveSetup(
					{ ...flags, tracker: entry.name, yes: true },
					true,
					deps,
				);
				const result = await materializeTracker(entry.name, options, deps);
				emit({ ok: true, kind: entry.kind, result });
			},
		);
	}

	beads
		.command("sync")
		.option("--beads-db <path>", "Override BEADS_DB")
		.description("Explicitly receive and publish the shared tracker snapshot")
		.action(async function sync(this: Command) {
			const options = this.optsWithGlobals<Options>();
			await deps.beads.sync(await checkout(options, deps), options.beadsDb, options.actor);
			emit({ ok: true, kind: "tracker_published" });
		});
	beads
		.command("session-start")
		.option(
			"--environment-file <path>",
			"Claude export destination; defaults to CLAUDE_ENV_FILE",
			deps.environmentFile,
		)
		.description("Read Claude SessionStart JSON from stdin and append selected environment")
		.action(async function session(this: Command) {
			const options = this.optsWithGlobals<Options>();
			if (!options.environmentFile) {
				throw new BeeswaxError("usage", "CLAUDE_ENV_FILE or --environment-file is required.", {
					exitCode: EXIT.usage,
				});
			}
			await deps.beads.sessionStart(JSON.parse(await deps.stdin()), options.environmentFile);
			if (program.opts<Options>().json) {
				emit({ ok: true, kind: "session_configured" });
			}
		});
}

async function materializeTracker(
	name: "init" | "bootstrap",
	options: Options,
	deps: Dependencies,
): Promise<unknown> {
	const repo = options.repo ?? deps.context.cwd;
	if (name === "init") {
		return await deps.beads.initialize(repo, options);
	}
	return { database: await deps.beads.bootstrap(repo, options) };
}

export function addSkills(
	program: Command,
	deps: Dependencies,
	emit: (value: object, text?: string) => void,
): void {
	const skills = program
		.command("skills")
		.description("Read bundled repository setup instructions");
	const list = async () => {
		const catalogue = await deps.skills.getSkills();
		const entries = catalogue.map(({ name, description, files }) => ({
			name,
			description,
			files,
		}));
		emit(
			{ ok: true, kind: "skills_list", skills: entries },
			entries.map((entry) => `${entry.name}\t${entry.description}`).join("\n"),
		);
	};
	skills.action(list);
	skills.command("list").action(list);
	const read = async (name: string, path: string) => {
		const catalogue = await deps.skills.getSkills();
		const skill = catalogue.find((entry) => entry.name === name);
		if (!skill || !skill.files.includes(path)) {
			throw new BeeswaxError("usage", `Unknown bundled skill resource: ${name}/${path}`, {
				exitCode: EXIT.usage,
			});
		}
		let content: string | null | undefined = skill.body;
		if (path !== "SKILL.md") {
			content = await deps.skills.getSkillFile(name, path);
		}
		if (content === undefined || content === null) {
			throw new BeeswaxError(
				"skill_resource_missing",
				`Bundled skill resource is missing: ${name}/${path}`,
			);
		}
		emit({ ok: true, kind: "skills_get", name, path, content }, content);
	};
	skills.command("get <name>").action((name: string) => read(name, "SKILL.md"));
	skills.command("file <name> <path>").action(read);
}

/** Migration tasks hand interpretation to an agent working with the user; they have no setup effects. */
export function addMigration(
	program: Command,
	deps: Dependencies,
	emit: (value: object, text?: string) => void,
): void {
	const migrate = program
		.command("migrate")
		.description("Print agent-guided migration tasks; no changes are made");
	for (const { subject, file } of [
		{ subject: "hooks", file: "hook-migration.md" },
		{ subject: "setup", file: "setup-migration.md" },
	]) {
		migrate
			.command(subject)
			.description(`Print the agreed outcomes for ${subject} migration with the user`)
			.action(async function migration(this: Command) {
				const content = await deps.skills.getSkillFile("repository-setup", `references/${file}`);
				if (content === null) {
					throw new BeeswaxError(
						"skill_resource_missing",
						"Bundled migration instructions are missing",
					);
				}
				emit(
					{
						ok: true,
						kind: "migration_instructions",
						subject,
						repository: this.optsWithGlobals<Options>().repo,
						requiresUser: true,
						content,
					},
					content,
				);
			});
	}
}

/** Sync reproduces committed intent; update deliberately advances it to the installed release. */
export function addProjectCommands(
	program: Command,
	deps: Dependencies,
	emit: (value: object) => void,
): void {
	program
		.command("lock")
		.description(
			"Refresh only the committed lock to this CLI's version; " +
				"requires an existing lock and unchanged normalized configuration",
		)
		.action(async function lockProject(this: Command) {
			const root = await checkout(this.optsWithGlobals<Options>(), deps);
			const lock = await readProjectLock(root, deps);
			const config = await readProjectConfig(root, deps);
			if (!lock || !config) {
				throw projectMigration(
					"An existing project configuration and lock are required to refresh the release pin.",
				);
			}
			requireProjectConfig(lock, config);
			requireProjectGeneration(lock, config);
			const lockfile = await writeProjectLock(root, deps);
			emit({ ok: true, kind: "project_locked", lockfile });
		});
	for (const { name, description } of [
		{ name: "sync", description: "Reproduce the committed Beeswax project contract" },
		{ name: "update", description: "Explicitly update the Beeswax project contract" },
	]) {
		const command = program.command(name);
		if (name === "update") {
			onboardingOptions(command).option("-y, --yes", "Keep saved selections without prompting");
		}
		command
			.description(`${description}; no tracker publication`)
			.option("--executable <path>", "Stable installed CLI", deps.context.executable)
			.action(async function synchronize(this: Command) {
				let flags = this.optsWithGlobals<Options>();
				const root = await checkout(flags, deps);
				if (name === "update" && !flags.yes && !flags.json && deps.context.tty) {
					const config = await readProjectConfig(root, deps);
					flags = { ...flags, ...(await deps.onboardingWizard(flags, config?.onboarding)) };
				}
				const executable = flags.executable ?? deps.context.executable;
				emit(
					await synchronizeProject({ ...flags, root, executable, update: name === "update" }, deps),
				);
			});
	}
}
