#!/usr/bin/env bun
// eslint-disable-next-line import/no-nodejs-modules -- Compose the native hook environment-file effect.
import { appendFile } from "node:fs/promises";
import { piExtensionSource } from "../pi-extension.macro.ts" with { type: "macro" };
import { runCli } from "../cli.ts";

const USER_ARGUMENTS = 2;

process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS), {
	env: process.env,
	appendEnvironment: appendFile,
	stdin: () => Bun.stdin.text(),
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	piExtension: piExtensionSource(),
});
