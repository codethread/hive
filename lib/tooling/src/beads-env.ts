import { resolveEnvironment, runCommand } from "./beads-environment.ts";

const environment = await resolveEnvironment(process.cwd(), runCommand);
console.log(JSON.stringify(environment));
