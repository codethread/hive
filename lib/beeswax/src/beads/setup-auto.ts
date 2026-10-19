import type { SetupIntegrations, SetupServices } from "./setup.ts";
import { resolveEnvironment } from "./environment.ts";
import { setupBeads } from "./setup.ts";

/** Prepare this checkout; source supplies only an otherwise unselected existing tracker. */
// eslint-disable-next-line max-statements -- Keep checkout precedence and local adoption in one ordered boundary.
export async function setupBeadsAutomatically(
	cwd: string,
	source: string,
	services: SetupServices,
): Promise<string | undefined> {
	const integrations: SetupIntegrations = { environment: "none" };
	if (services.commandAvailable("mise", cwd)) {
		integrations.environment = "mise";
	}
	if (services.beadsDb === undefined && integrations.environment === "none") {
		return;
	}
	let environment = await resolveEnvironment(cwd, services.command, services.beadsDb);
	if (environment === undefined && source !== cwd) {
		environment = await resolveEnvironment(source, services.command, services.beadsDb);
	}
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
