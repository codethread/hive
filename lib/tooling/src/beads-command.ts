import { parseEnvironment, runCommand } from "./beads-environment.ts";
import { syncBeads, withTrackerLock } from "./beads-publish.ts";

const argumentOffset = 2;
const success = 0;
const environment = parseEnvironment(process.env);
const commandArguments = process.argv.slice(argumentOffset);

process.exitCode = await withTrackerLock(environment, async () => {
	await syncBeads(environment, runCommand);
	const child = Bun.spawn(
		[environment.HIVE_BR_BIN, "--db", environment.BEADS_DB, ...commandArguments],
		{
			stderr: "inherit",
			stdin: "inherit",
			stdout: "inherit",
		},
	);
	const exitCode = await child.exited;
	if (exitCode === success) {
		await syncBeads(environment, runCommand);
	}
	return exitCode;
});
