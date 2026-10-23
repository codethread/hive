#!/usr/bin/env bun
import { createLiveDependencies } from "../src/live.ts";
import { runCli } from "../src/cli.ts";

const USER_ARGUMENTS = 2;
if (import.meta.main) {
	process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS), {
		...createLiveDependencies(),
		loadSkills: async () => {
			const { createBundledSkills } = await import("../src/bundled-skills.ts");
			return createBundledSkills();
		},
	});
}
