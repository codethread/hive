#!/usr/bin/env bun
import { inspectRequest, listRequests, stopRequest } from "../src/requests.ts";
import { runBeeCli } from "../src/bee-cli.ts";
import { spawnRequest } from "../src/producer.ts";

const USER_ARGUMENTS_START = 2;
process.exitCode = await runBeeCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	list: listRequests,
	spawn: spawnRequest,
	status: inspectRequest,
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: stopRequest,
});
