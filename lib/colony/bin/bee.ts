#!/usr/bin/env bun
/* eslint-disable import/no-nodejs-modules --
 * Paths and filesystem validation are owned by the application I/O boundary.
 */
/* eslint-disable import/max-dependencies -- CLI composes offline tracker commands and execution-report transports. */
import { acknowledgeRequest, inspectRequest, stopRequest } from "../src/requests.ts";
import { attachWorkflow, dispatchStage, submitWorkflow } from "../src/workflow-submission.ts";
import { dirname, join } from "node:path";
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
import { submitAssessment } from "../src/postrun.ts";
import { submitDroneVerdict } from "../src/drone.ts";
import { submitFinish } from "../src/launch.ts";
import { workflowCommands } from "../src/workflows.ts";

const USER_ARGUMENTS_START = 2;
const tracker = { beads: createNativeBeads(), resolveRepository, loadBeesConfig };
const setupFiles = {
	checkouts: setupCheckouts,
	read: async (path: string) => {
		const file = Bun.file(path);
		if (await file.exists()) {
			return file.text();
		}
		return "";
	},
	write: async (path: string, contents: string) => {
		await Bun.write(path, contents);
	},
};
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
	setup: (options) => setupBee(options, { ...tracker, setupFiles }),
	ack: (id, options) => acknowledgeRequest(id, options, tracker),
	assess: submitAssessment,
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
	report: submitDroneVerdict,
	retry: (id, options) => retryRequest(id, options, tracker),
	run: runKind,
	spawn: (kind, options) => submitWorkflow(kind, options, submission),
	status: (id, options) => inspectRequest(id, options, tracker),
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: (id, options) => stopRequest(id, options, tracker),
});

/** Validate the two Git checkouts before installing checkout-local viewer policy. */
async function setupCheckouts(caller: string, database: string): Promise<string[]> {
	const output = await execute(["git", "rev-parse", "--show-toplevel"], caller, process.env);
	const cwd = output.trim();
	const permanent = dirname(dirname(database));
	const common = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"];
	const [callerCommon, trackerCommon, branch] = await Promise.all([
		execute(common, cwd, process.env),
		execute(common, permanent, process.env),
		execute(["git", "branch", "--show-current"], permanent, process.env),
	]);
	if (
		callerCommon.trim() !== trackerCommon.trim() ||
		branch.trim() !== "tracker/state" ||
		database !== join(permanent, ".beads/beads.db")
	) {
		throw new Error(`Expected ${database} in this repository's permanent tracker/state checkout.`);
	}
	return [cwd, permanent];
}
