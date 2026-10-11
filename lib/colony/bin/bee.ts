#!/usr/bin/env bun
/* eslint-disable import/max-dependencies -- CLI composes offline tracker commands and execution-report transports. */
import { acknowledgeRequest, inspectRequest, listRequests, stopRequest } from "../src/requests.ts";
import { retryRequest, spawnRequest } from "../src/producer.ts";
import { createNativeBeads } from "@hive/beads";
import { listKinds } from "../src/kinds.ts";
import { loadBeesConfig } from "../src/config.ts";
import { resolveRepository } from "@hive/shared";
import { runBeeCli } from "../src/bee-cli.ts";
import { runKind } from "../src/run.ts";
import { submitAssessment } from "../src/postrun.ts";
import { submitDroneVerdict } from "../src/drone.ts";
import { submitFinish } from "../src/launch.ts";

const USER_ARGUMENTS_START = 2;
const tracker = { beads: createNativeBeads(), resolveRepository, loadBeesConfig };
process.exitCode = await runBeeCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	ack: (id, options) => acknowledgeRequest(id, options, tracker),
	assess: submitAssessment,
	finish: submitFinish,
	kinds: listKinds,
	list: (options) => listRequests(options, tracker),
	report: submitDroneVerdict,
	retry: (id, options) => retryRequest(id, options, tracker),
	run: runKind,
	spawn: (kind, ids, options) => spawnRequest({ kind, requestedIds: ids, options }, tracker),
	status: (id, options) => inspectRequest(id, options, tracker),
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: (id, options) => stopRequest(id, options, tracker),
});
