import { checkBeadsHealth, withTrackerLock } from "./beads-publish.ts";
import { resolveEnvironment, runCommand } from "./beads-environment.ts";

const environment = await resolveEnvironment(process.cwd(), runCommand);
await withTrackerLock(environment, () => checkBeadsHealth(environment, runCommand));
