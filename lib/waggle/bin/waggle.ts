#!/usr/bin/env bun

import { createLiveDependencies } from "../src/live-deps.ts";
import { runCli } from "../src/cli.ts";

const USER_ARGUMENTS_START = 2;

if (import.meta.main) {
	process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS_START), createLiveDependencies());
}
