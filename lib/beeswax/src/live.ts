/* eslint-disable import/max-dependencies -- This application boundary composes independent native adapters. */
import { BeeswaxError, EXIT, errorMessage } from "./errors.ts";
import { CapturedCommandError, runCommand } from "./beads/environment.ts";
import type { ProcessResult, WorkspaceIO } from "./services.ts";
import type { SetupFlags, SetupOptions } from "./setup.ts";
import {
	alertSessionReceiptPath,
	alertStateHome,
	createNativeAlertStore,
} from "./beads/alerts-native.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native filesystem adapter composition.
import { appendFile, chmod, readdir, realpath, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Native executable paths.
import { basename, resolve } from "node:path";
import {
	bootstrapBeads,
	initializeBeads,
	localBootstrapServices,
	preflightInitialization,
} from "./beads/bootstrap.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Default human owner is the local account.
import { homedir, userInfo } from "node:os";
import { onboardingWizard, setupWizard } from "./wizard.ts";
import { syncBeads, withTrackerLock } from "./beads/publish.ts";
import type { BootstrapServices } from "./beads/bootstrap.ts";
import type { Dependencies } from "./cli.ts";
import { createBundledSkills } from "./skills.ts";
import { createNativeBeads } from "@hive/beads";
import { installArtifacts } from "./artifact-native.ts";
import { installationInfo } from "./info.ts";
import { mergeFiles } from "./git/merge.ts";
import { packRepository } from "./git/pack.ts";
import { publishWithAlert } from "./beads/alerts-publication.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Artifact destinations are resolved at the native boundary.
import { runSessionStart } from "./beads/hook.ts";
import { selectAlertDatabase } from "./beads/alerts-selection.ts";
import { setupBeads } from "./beads/setup.ts";
import { setupBeadsAutomatically } from "./beads/setup-auto.ts";
import { validateStagedSnapshot } from "./git/validate.ts";
import { waitForAlert } from "./beads/alerts.ts";

/** Capture process context once and compose native adapters at the application boundary. */
// eslint-disable-next-line max-statements -- Compose independent native adapters at this application boundary.
export function createLiveDependencies(): Dependencies {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		BD_ACTOR: process.env.BD_ACTOR ?? "sys-beeswax",
	};
	const context = {
		cwd: process.cwd(),
		owner: userInfo().username,
		actor: environment.BD_ACTOR ?? "sys-beeswax",
		beadsDb: environment.BEADS_DB ?? "",
		executable: installedExecutable(),
		tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
	};
	const io = workspaceIO(environment);
	const beads = createNativeBeads({ execute: io.command });
	const services: BootstrapServices = {
		...localBootstrapServices,
		actor: context.actor,
		beads,
		command: io.command,
		exists: io.exists,
		readConfig: io.read,
		write: io.write,
	};
	const stateHome = alertStateHome(environment.XDG_STATE_HOME, homedir());
	const alerts = createNativeAlertStore(stateHome);
	const selectedAlertDatabase = (repo: string, database?: string) =>
		selectAlertDatabase(repo, database, {
			beadsDb: environment.BEADS_DB,
			observe: alerts.observe,
			command: io.command,
			exists: io.exists,
			commandAvailable: (name, cwd) =>
				Bun.which(name, { PATH: environment.PATH ?? "", cwd }) !== null,
		});
	const selectedEnvironment = async (repo: string, database?: string) => {
		const selected = await selectedAlertDatabase(repo, database);
		if (selected === undefined) {
			throw new BeeswaxError(
				"tracker_unselected",
				"No tracker is selected. Supply --beads-db or BEADS_DB.",
			);
		}
		return { BEADS_DB: selected };
	};
	const withActor = (flags: SetupFlags) => ({ ...services, actor: flags.actor ?? context.actor });
	const integrations = (flags: SetupFlags) => ({
		environment: flags.environment ?? "mise",
		codex: flags.codex ?? true,
	});
	return {
		...io,
		alertReceiptPath: (database, session) => alertSessionReceiptPath(stateHome, database, session),
		commandAvailable: (name, cwd) =>
			Bun.which(name, { PATH: environment.PATH ?? "", cwd }) !== null,
		installationInfo: async () => installationInfo(await realpath(process.execPath), io),
		context,
		wizard: setupWizard,
		onboardingWizard,
		skills: createBundledSkills(),
		binDirectory: resolve(homedir(), ".local/bin"),
		installArtifacts: (source, destination, names) =>
			installArtifacts(resolve(source), resolve(destination), names),
		stdout: (text) => {
			process.stdout.write(text);
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
		stdin: () => Bun.stdin.text(),
		source: environment.WK_ROOT ?? context.cwd,
		environmentFile: environment.CLAUDE_ENV_FILE ?? "",
		operations: {
			preflight: async (options) => {
				await preflightInitialization(options.repo, withActor(options), integrations(options));
			},
			tracker: async (options: SetupOptions) => {
				if (options.tracker === "init") {
					const initialized = await initializeBeads(
						options.repo,
						options,
						withActor(options),
						integrations(options),
					);
					return initialized.database;
				}
				if (options.tracker === "bootstrap") {
					return await bootstrapBeads(options.repo, withActor(options), integrations(options));
				}
				return await setupBeads(
					options.repo,
					{ kind: "database", database: options.beadsDb },
					withActor(options),
					integrations(options),
				);
			},
		},
		beads: {
			setup: (repo, selection, flags) =>
				setupBeads(repo, selection, withActor(flags), integrations(flags)),
			bootstrap: (repo, flags) => bootstrapBeads(repo, withActor(flags), integrations(flags)),
			initialize: (repo, flags) =>
				initializeBeads(
					repo,
					{
						prefix: flags.prefix ?? "",
						owner: flags.owner ?? context.owner,
					},
					withActor(flags),
					integrations(flags),
				),
			environment: selectedEnvironment,
			alertStatus: async (repo, database) => {
				const selected = await selectedAlertDatabase(repo, database);
				if (selected === undefined) {
					return;
				}
				return await alerts.observe(selected);
			},
			alertWait: async (repo, seconds, database) => {
				const selected = await selectedAlertDatabase(repo, database);
				if (selected === undefined) {
					throw new BeeswaxError(
						"tracker_unselected",
						"No tracker is selected. Supply --beads-db or BEADS_DB.",
					);
				}
				return await waitForAlert(selected, seconds, {
					observe: alerts.observe,
					now: () => performance.now(),
					sleep: (milliseconds) => Bun.sleep(milliseconds),
				});
			},
			sync: async (repo, database, options) => {
				const selected = await selectedEnvironment(repo, database);
				const publicationBeads = createNativeBeads({
					execute: (argv, cwd) =>
						runCommand(argv, cwd, { ...environment, BD_ACTOR: options?.actor ?? context.actor }),
				});
				const notifications: string[] = [];
				await publishWithAlert(
					selected.BEADS_DB,
					{
						alerts,
						withPublicationLock: (action) => withTrackerLock(selected, action),
						publish: async () => {
							try {
								await syncBeads(
									selected,
									{ beads: publicationBeads, command: io.command },
									{
										notify: sendConflictNotification,
										report: (message) => {
											notifications.push(message);
										},
									},
								);
							} catch (error) {
								throw new BeeswaxError("tracker_sync_failed", errorMessage(error), {
									context: {
										database: selected.BEADS_DB,
										notifications,
										...nativeFailureContext(error),
									},
								});
							}
						},
					},
					options?.recovery,
				);
			},
			automatic: (repo, source) => setupBeadsAutomatically(repo, source, services),
			sessionStart: (input, file) =>
				runSessionStart(input, file, {
					command: io.command,
					environment: selectedEnvironment,
					append: appendFile,
				}),
		},
		git: {
			merge: (paths) =>
				mergeFiles(paths, { read: (path) => Bun.file(path).text(), write: io.write }),
			validate: (repo) => validateStagedSnapshot(repo, io.command),
			pack: (repo) => packRepository(repo, io.command),
		},
	};
}

// --- Private functions ---

function workspaceIO(environment: NodeJS.ProcessEnv): WorkspaceIO {
	const exec = async (argv: readonly string[], cwd: string): Promise<ProcessResult> => {
		const child = Bun.spawn([...argv], { cwd, env: environment, stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, exitCode };
	};
	return {
		exec,
		list: async (path) => {
			try {
				return await readdir(path);
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") {
					return [];
				}
				throw error;
			}
		},
		chmod,
		remove: (path) => rm(path, { force: true }),
		read: async (path) => {
			const file = Bun.file(path);
			if (await file.exists()) {
				return await file.text();
			}
			return "";
		},
		exists: (path) => Bun.file(path).exists(),
		write: async (path, contents) => {
			await Bun.write(path, contents);
		},
		command: async (argv, cwd) => {
			const result = await exec(argv, cwd);
			if (result.exitCode !== EXIT.success) {
				throw new BeeswaxError(
					"command_failed",
					`${argv.join(" ")} failed (${result.exitCode}): ${[result.stderr, result.stdout].filter(Boolean).join("\n")}`,
					{
						context: { command: argv, ...result },
						exitCode: result.exitCode,
					},
				);
			}
			return result.stdout.trim();
		},
	};
}

/** Preserve desktop conflict alerts while keeping child output inside the CLI receipt. */
async function sendConflictNotification(body: string): Promise<void> {
	const child = Bun.spawn(["cc-notify", "Beads conflict"], {
		killSignal: "SIGKILL",
		stderr: "pipe",
		stdin: new Blob([`${body}\n`]),
		stdout: "pipe",
		timeout: 10_000,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== EXIT.success) {
		throw new Error(`cc-notify failed (${code}): ${stderr || stdout}`);
	}
}

/** Source prepare bootstraps the conventional installed target; compiled invocations use themselves. */
function installedExecutable(): string {
	if (basename(process.execPath) === "beeswax") {
		return process.execPath;
	}
	return resolve(homedir(), ".local/bin/beeswax");
}

function nativeFailureContext(error: unknown): Record<string, unknown> {
	if (error instanceof CapturedCommandError) {
		return { native: { code: error.code, stdout: error.stdout, stderr: error.stderr } };
	}
	if (error instanceof BeeswaxError) {
		return error.context;
	}
	return {};
}
