#!/usr/bin/env bun
import { inspectRequest, listRequests, stopRequest } from "../src/requests.ts";
import { retryRequest, spawnRequest } from "../src/producer.ts";
import { listKinds } from "../src/kinds.ts";
import { runBeeCli } from "../src/bee-cli.ts";
import { submitDroneVerdict } from "../src/drone.ts";
import { submitFinish } from "../src/launch.ts";

const USER_ARGUMENTS_START = 2;
process.exitCode = await runBeeCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	finish: submitFinish,
	kinds: listKinds,
	list: listRequests,
	report: submitDroneVerdict,
	retry: retryRequest,
	spawn: spawnRequest,
	status: inspectRequest,
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: stopRequest,
});
