import type { SetupServices } from "./setup.ts";
import { resolveEnvironment } from "./environment.ts";
import { setupBeads } from "./setup.ts";

/** Inherit an existing selection after checkout preparation without creating tracker history. */
export async function setupBeadsAutomatically(
	cwd: string,
	source: string,
	services: SetupServices,
): Promise<string | undefined> {
	if (!(await services.exists(`${source}/mise.local.toml`))) {
		return undefined;
	}
	const environment = await resolveEnvironment(source, services.command);
	if (!(await services.exists(environment.BEADS_DB))) {
		return undefined;
	}
	return await setupBeads(cwd, { database: environment.BEADS_DB, kind: "database" }, services);
}
