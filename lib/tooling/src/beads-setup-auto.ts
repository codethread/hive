import { localSetupServices, setupBeads } from "./beads-setup.ts";
import { resolveEnvironment, runCommand } from "./beads-environment.ts";

const source = process.env.WK_ROOT ?? process.cwd();
let configured = false;
if (await Bun.file(`${source}/mise.local.toml`).exists()) {
	const environment = await resolveEnvironment(source, runCommand);
	if (await Bun.file(environment.BEADS_DB).exists()) {
		await setupBeads(
			process.cwd(),
			{ database: environment.BEADS_DB, kind: "database" },
			localSetupServices,
		);
		configured = true;
	}
}
if (!configured) {
	console.log(
		"Beads is not configured here. Run mise trust, then mise run; the " +
			"default task bootstraps this clone's tracker after install/build.",
	);
}
