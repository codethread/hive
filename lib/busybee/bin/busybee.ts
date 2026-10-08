#!/usr/bin/env bun

import { createServices } from "../src/native.ts";
import { runCli } from "../src/cli.ts";

const USER_ARGUMENTS_START = 2;

if (import.meta.main) {
	process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS_START), createServices(), {
		stderr: (text) => {
			process.stderr.write(text);
		},
		stdout: (text) => {
			process.stdout.write(text);
		},
	});
}
