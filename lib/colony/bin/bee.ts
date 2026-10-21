#!/usr/bin/env bun
/* eslint-disable import/no-nodejs-modules --
 * Paths and filesystem validation are owned by the application I/O boundary.
 */
/* eslint-disable import/max-dependencies -- CLI composes offline tracker commands and execution-report transports. */
import { acknowledgeRequest, inspectRequest, stopRequest } from "../src/requests.ts";
import { attachWorkflow, dispatchStage, submitWorkflow } from "../src/workflow-submission.ts";
import { execute, resolveRepository } from "@hive/shared";
import {
	findResponses,
	publishTaskResponse,
	readRequestResult,
	readResponseHistory,
	readTaskResponse,
} from "../src/responses.ts";
import { realpath, stat } from "node:fs/promises";
import { retryRequest, validateRequestedTasks } from "../src/producer.ts";
import type { SpawnOptions } from "../src/bee-cli.ts";
import { createNativeBeads } from "@hive/beads";
import { listKinds } from "../src/kinds.ts";
import { loadBeesConfig } from "../src/config.ts";
import { runBeeCli } from "../src/bee-cli.ts";
import { runKind } from "../src/run.ts";
import { setupBee } from "../src/setup.ts";
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
	setup: (options) => setupBee(options, tracker),
	ack: (id, options) => acknowledgeRequest(id, options, tracker),
	attachWorkflow: (kind, runId, options) => attachWorkflow({ kind, runId, options }, submission),
	dispatchStage: (kind, stageId, options) => dispatchStage({ kind, stageId, options }, submission),
	finish: submitFinish,
	kinds: listKinds,
	responsePublish: (task, options) =>
		publishTaskResponse(task, options, {
			...tracker,
			readBody: (file) => Bun.file(file).text(),
			managedRequestId: process.env["HIVE_SPAWN_ID"],
		}),
	responseGet: (id, options) => readTaskResponse(id, options, tracker),
	responseSearch: (query, options) => findResponses(query, options, tracker),
	responseHistory: (task, options) => readResponseHistory(task, options, tracker),
	result: (id, options) => readRequestResult(id, options, tracker),
	retry: (id, options) => retryRequest(id, options, tracker),
	run: runKind,
	spawn: (kind, options) => submitWorkflow(kind, options, submission),
	status: (id, options) => inspectRequest(id, options, tracker),
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: (id, options) => stopRequest(id, options, tracker),
});
