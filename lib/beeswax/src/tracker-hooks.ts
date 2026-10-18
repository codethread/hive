// eslint-disable-next-line import/no-nodejs-modules -- Resolve canonical roots and configured hook paths.
import { dirname, resolve } from "node:path";
import { hookMigration, updateHookSection } from "./hooks.ts";
import { EXIT } from "./errors.ts";
import type { ProjectConfig } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { bindCheckout } from "./binding.ts";
import { bootstrapHooks } from "./husky.ts";
import { parseDatabase } from "./beads/environment.ts";

/** Require exact sections in canonical HEAD for checkout-resident hooks before setup effects. */
export async function verifyTrackerInitialization(
	repository: string,
	config: ProjectConfig,
	io: WorkspaceIO,
): Promise<void> {
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		repository,
	);
	const root = dirname(common);
	const paths = Object.values(config.hooks).filter((path) => !path.startsWith(".git/"));
	const bodies = await Promise.all(
		paths.map(async (path) => {
			const result = await io.exec(["git", "show", `HEAD:${path}`], root);
			if (result.exitCode !== EXIT.success || result.stdout === "") {
				throw hookMigration(
					`Canonical HEAD at ${root} has a missing or empty configured hook: ${path}. ` +
						"Run beeswax setup --tracker none there, then review and commit the project contract " +
						"and hook sections before retrying init.",
				);
			}
			return result.stdout;
		}),
	);
	for (const body of bodies) {
		if (updateHookSection(body) !== body) {
			throw hookMigration(
				"Prepare the current validation section in the configured tracker hooks before binding.",
			);
		}
	}
}

/** Bind the same declared hooks without rewriting the permanent tracker's accepted files. */
// eslint-disable-next-line max-statements -- Check tracker identity and configured sections before local activation.
export async function installTrackerHooks(
	options: { repository: string; database: string; executable: string; config: ProjectConfig },
	io: WorkspaceIO,
): Promise<void> {
	const { executable, config } = options;
	const root = dirname(dirname(parseDatabase(options.database)));
	const branch = await io.command(["git", "branch", "--show-current"], root);
	if (branch !== "tracker/state") {
		throw hookMigration(`The selected tracker must be on tracker/state; found ${branch}.`);
	}
	const common = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		root,
	);
	const projectCommon = await io.command(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		options.repository,
	);
	if (common !== projectCommon) {
		throw hookMigration("The selected tracker belongs to another Git repository.");
	}
	const bodies = await Promise.all(
		Object.values(config.hooks).map((path) => {
			let target = resolve(root, path);
			if (path.startsWith(".git/")) {
				target = resolve(common, path.slice(".git/".length));
			}
			return io.read(target);
		}),
	);
	for (const body of bodies) {
		if (body === "") {
			throw hookMigration(
				"The tracker is missing a configured hook. " +
					"Prepare the same configured hook files in the tracker with the user.",
			);
		}
		if (updateHookSection(body) !== body) {
			throw hookMigration(
				"Prepare the current validation section in the configured tracker hooks before binding.",
			);
		}
	}
	await bindCheckout(root, executable, io);
	await bootstrapHooks(root, config.bootstrap.hooks, io);
}
