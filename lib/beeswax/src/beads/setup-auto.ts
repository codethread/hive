import type { SetupIntegrations, SetupServices } from "./setup.ts";
import { resolveEnvironment } from "./environment.ts";
import { setupBeads } from "./setup.ts";

/** Inherit an existing selection after checkout preparation without creating tracker history. */
export async function setupBeadsAutomatically(
	cwd: string,
	source: string,
	services: SetupServices,
): Promise<string | undefined> {
	const integrations: SetupIntegrations = { environment: "none" };
	if (services.commandAvailable("mise", source)) {
		integrations.environment = "mise";
	}
	if (services.beadsDb === undefined && integrations.environment === "none") {
		return;
	}
	const environment = await resolveEnvironment(source, services.command, services.beadsDb);
	if (environment === undefined || !(await services.exists(environment.BEADS_DB))) {
		return undefined;
	}
	return await setupBeads(
		cwd,
		{ database: environment.BEADS_DB, kind: "database" },
		services,
		integrations,
	);
}
