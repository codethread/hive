/* eslint-disable import/max-dependencies -- Compose synchronization phases and version discovery receipt. */
import { BeeswaxError, errorMessage } from "./errors.ts";
import { installHooks, installMergeDriver } from "./hooks.ts";
import {
	projectMigration,
	readProjectLock,
	requireBvRecipesContract,
	requireProjectConfig,
	requireProjectGeneration,
	requireProjectVersion,
	verifyExecutable,
	writeProjectLock,
} from "./project.ts";
import { readProjectConfig, selectOnboardingConfig, writeProjectConfig } from "./config.ts";
import type { BvRecipeFiles } from "./bv-recipes.ts";
import type { Dependencies } from "./cli.ts";
import type { OnboardingFlags } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { applyOnboarding } from "./onboarding.ts";
import { applyTrackerPolicy } from "./beads/setup.ts";
import { bindCheckout } from "./binding.ts";
import { bootstrapHooks } from "./husky.ts";
import { installBvRecipes } from "./bv-recipes.ts";
import { installTrackerHooks } from "./tracker-hooks.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve this clone's conventional tracker.
import { resolve } from "node:path";
import { trackerRoot } from "./beads/environment.ts";
import { updateChangelogs } from "./prime.ts";
import { version } from "../package.json";

const NONEMPTY = 1;

/** Reproduce accepted intent, reporting completed phases if local materialization stops. */
// eslint-disable-next-line max-statements -- Keep preflight, materialization and its partial-effect receipt together.
export async function synchronizeProject(
	options: { root: string; executable: string; update: boolean } & OnboardingFlags,
	io: WorkspaceIO &
		Pick<Dependencies, "commandAvailable" | "nativeBeads"> & {
			context: { beadsDb: string; actor: string };
			bvRecipeFiles: BvRecipeFiles;
		},
) {
	const { root, executable, update } = options;
	const completed: string[] = [];
	const bvRecipes: string[] = [];
	try {
		const lock = await readProjectLock(root, io);
		if (!lock) {
			throw new BeeswaxError(
				"project_not_configured",
				"Run beeswax setup to create .hive/beeswax/meta/lock.json first",
			);
		}
		const saved = await readProjectConfig(root, io);
		if (!saved) {
			throw projectMigration("Missing .hive/beeswax/config.toml.");
		}
		let config = saved;
		if (update) {
			config = selectOnboardingConfig(saved, options);
		}
		if (!update) {
			requireProjectVersion(lock);
			requireProjectConfig(lock, config);
			requireBvRecipesContract(lock);
		}
		requireProjectGeneration(lock, config);
		await verifyExecutable(root, executable, io);
		const hooks = await installHooks({ root, config }, io);
		completed.push("hook_sections");
		await bindCheckout(root, executable, io);
		completed.push("local_binding");
		await installMergeDriver(root, executable, io);
		completed.push("merge_driver");
		const common = await io.command(
			["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
			root,
		);
		const database =
			io.context.beadsDb || resolve(common, "../.worktrees/tracker--state/.beads/beads.db");
		const checkouts = [root];
		if (await io.exists(database)) {
			await installTrackerHooks({ repository: root, database, executable, config }, io);
			completed.push("tracker_hooks");
			await applyTrackerPolicy(
				database,
				{ beads: config.beads, adopt: update },
				{ beads: io.nativeBeads, actor: io.context.actor },
			);
			if (config.beads) {
				completed.push("tracker_policy");
			}
			checkouts.push(trackerRoot(database));
		}
		bvRecipes.push(...(await installBvRecipes(checkouts, io.bvRecipeFiles)));
		completed.push("bv_recipes");
		await bootstrapHooks(root, config.bootstrap.hooks, io);
		completed.push("hook_bootstrap");
		const onboarding = await applyOnboarding(root, config.onboarding, io);
		if (onboarding.length >= NONEMPTY) {
			completed.push("onboarding");
		}
		if (update) {
			await writeProjectConfig(root, config, io);
			await writeProjectLock(root, io);
			completed.push("project_lock");
		}
		const result = {
			ok: true,
			kind: "project_synchronized",
			repository: root,
			hooks,
			bvRecipes,
			projectLockUpdated: update,
			completed,
		};
		if (update) {
			return {
				...result,
				changelogs: updateChangelogs(lock.beeswaxVersion, version, (name) =>
					io.commandAvailable(name, root),
				),
			};
		}
		return result;
	} catch (error) {
		let failure = new BeeswaxError("synchronization_failed", errorMessage(error));
		if (error instanceof BeeswaxError) {
			failure = error;
		}
		throw new BeeswaxError(failure.reason, failure.message, {
			context: {
				...failure.context,
				repository: root,
				completed,
				bvRecipes: failure.context.bvRecipes ?? bvRecipes,
			},
			exitCode: failure.exitCode,
		});
	}
}
