import { installHk, preflightHk, preflightHkCheckout } from "./hk.ts";
import type { HookAdapter } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { bootstrapHooks as bootstrapShellHooks } from "./husky.ts";
import { hookMigration } from "./hooks.ts";
import { trackerRoot } from "./beads/environment.ts";

export async function preflightHookBootstrap(
	options: { root: string; adapter: HookAdapter; database: string | undefined },
	io: WorkspaceIO,
): Promise<void> {
	if (options.adapter !== "hk") {
		return;
	}
	await preflightHk(options.root, io);
	if (options.database !== undefined && (await io.exists(options.database))) {
		const tracker = trackerRoot(options.database);
		const command = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"];
		const [common, trackerCommon, branch] = await Promise.all([
			io.command(command, options.root),
			io.command(command, tracker),
			io.command(["git", "branch", "--show-current"], tracker),
		]);
		if (common !== trackerCommon || branch !== "tracker/state") {
			throw hookMigration(
				`The selected tracker ${tracker} must belong to this repository and be on tracker/state.`,
			);
		}
		await preflightHkCheckout(tracker, io);
	}
}

export async function bootstrapHooks(
	root: string,
	adapter: HookAdapter,
	io: WorkspaceIO,
): Promise<void> {
	if (adapter === "hk") {
		await installHk(root, io);
		return;
	}
	await bootstrapShellHooks(root, adapter, io);
}
