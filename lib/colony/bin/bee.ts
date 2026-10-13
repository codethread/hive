#!/usr/bin/env bun
/* eslint-disable import/no-nodejs-modules --
 * Paths and filesystem validation are owned by the application I/O boundary.
 */
/* eslint-disable import/max-dependencies -- CLI composes offline tracker commands and execution-report transports. */
import { acknowledgeRequest, inspectRequest, listRequests, stopRequest } from "../src/requests.ts";
import { attachWorkflow, dispatchStage, submitWorkflow } from "../src/workflow-submission.ts";
import { execute, resolveRepository } from "@hive/shared";
import { realpath, stat } from "node:fs/promises";
import { retryRequest, validateRequestedTasks } from "../src/producer.ts";
import type { SpawnOptions } from "../src/bee-cli.ts";
import { createNativeBeads } from "@hive/beads";
import { listKinds } from "../src/kinds.ts";
import { loadBeesConfig } from "../src/config.ts";
import { runBeeCli } from "../src/bee-cli.ts";
import { runKind } from "../src/run.ts";
import { submitAssessment } from "../src/postrun.ts";
import { submitDroneVerdict } from "../src/drone.ts";
import { submitFinish } from "../src/launch.ts";
import { workflowCommands } from "../src/workflows.ts";

const USER_ARGUMENTS_START = 2;
const tracker = { beads: createNativeBeads(), resolveRepository, loadBeesConfig };
const submission = {
	...tracker,
	cwd: process.cwd(),
	workflows: workflowCommands({ execute: (argv, cwd) => execute(argv, cwd, process.env) }),
	executionDirectory: async (directory: string) => {
		const path = await realpath(directory);
		const info = await stat(path);
		if (!info.isDirectory()) {
			throw new Error(`Execution cwd is not a directory: ${path}`);
		}
		return path;
	},
	admit: async (runId: string, options: SpawnOptions) => {
		await validateRequestedTasks({ requestedIds: [runId], options }, tracker);
	},
};
process.exitCode = await runBeeCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	ack: (id, options) => acknowledgeRequest(id, options, tracker),
	assess: submitAssessment,
	attachWorkflow: (kind, runId, options) => attachWorkflow({ kind, runId, options }, submission),
	dispatchStage: (kind, stageId, options) => dispatchStage({ kind, stageId, options }, submission),
	finish: submitFinish,
	kinds: listKinds,
	list: (options) => listRequests(options, tracker),
	report: submitDroneVerdict,
	retry: (id, options) => retryRequest(id, options, tracker),
	run: runKind,
	spawn: (kind, options) => submitWorkflow(kind, options, submission),
	status: (id, options) => inspectRequest(id, options, tracker),
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: (id, options) => stopRequest(id, options, tracker),
});
