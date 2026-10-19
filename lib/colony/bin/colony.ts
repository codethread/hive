#!/usr/bin/env bun
/* eslint-disable max-dependencies -- CLI composes daemon commands and independent read-only inspection boundaries. */
import { CommandError, createNativeBeads } from "@hive/beads";
import type { ConfigOptions, ServerOptions } from "../src/cli.ts";
import {
	authorizeWorkReview,
	readWorkReviewControl,
	recoverWorkReview,
} from "../src/work-review-runtime.ts";
import { colonyEntry, entryCommand } from "../src/executables.ts";
import {
	execute,
	policyChangeSchema,
	resolveRepository,
	workReviewRecordSchema,
	workReviewRecoverSchema,
} from "@hive/shared";
import { preflightWorkReview, recordWorkReview } from "../src/work-review.ts";
import {
	prepareSupervisedServer,
	readDaemonHandoff,
	readDaemonOwner,
	readPendingRestart,
	recordRestart,
	selectedSupervisor,
	startSupervisedServer,
	verifySupervisedServer,
	withDaemonLock,
} from "../src/daemon-supervisor.ts";
import { requestLazyServer, restartServer } from "../src/daemon-lifecycle.ts";
import type { ConfigCommand } from "@hive/shared";
import type { ServerTarget } from "../src/client.ts";
import { explainRequest } from "../src/explain.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Bind public review commands to this owning host.
import { hostname } from "node:os";
import { initRepository } from "../src/producer.ts";
import { launchedResultSchema } from "../src/output.ts";
import { loadBeesConfig } from "../src/config.ts";
import { match } from "ts-pattern";
import { observeProcess } from "../src/processes.ts";
import { readAssessments } from "../src/assessments.ts";
import { readHistory } from "../src/history.ts";
import { requestServer } from "../src/client.ts";
import { resolveServerTarget } from "../src/server-target.ts";
import { runCli } from "../src/cli.ts";
import { workReviewCommands } from "../src/work-review-commands.ts";

const USER_ARGUMENTS_START = 2;
const POLL_INTERVAL_MS = 50;
const beads = createNativeBeads();
const SUCCESS = 0;
const runtime = colonyEntry("runtime");
const lifecycle = {
	prepare: prepareSupervisedServer,
	handoff: readDaemonHandoff,
	pending: readPendingRestart,
	record: recordRestart,
	request: requestServer,
	owner: readDaemonOwner,
	observe: observeProcess,
	start: startSupervisedServer,
	supervisor: selectedSupervisor,
	verify: verifySupervisedServer,
	now: () => performance.now(),
	pause: () => Bun.sleep(POLL_INTERVAL_MS),
};
process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	// eslint-disable-next-line max-statements -- Keep this native operation and its evidence in order.
	workReview: async (options) => {
		const repository = await resolveRepository(options.repo, options.beadsDb);
		const { config } = await loadBeesConfig(repository.root);
		const reviewRuntime = {
			beads,
			repository,
			config,
			actor: options.actor,
			host: hostname(),
			now: Date.now,
			state: target(options).state,
			workReview: workReviewCommands(
				{
					execute: (argv, cwd) => execute(argv, cwd, process.env),
					writeInput: () => {
						throw new Error("This operation does not submit a review workflow");
					},
				},
				target(options).state,
			),
		};
		await reviewRuntime.workReview.assertTracker(repository);
		if (options.operation === "preflight") {
			return preflightWorkReview(reviewRuntime, options.branch);
		}
		if (options.operation === "inspect") {
			const { control } = await readWorkReviewControl(reviewRuntime);
			return { kind: "work_review_inspection", control };
		}
		const input: unknown = await Bun.file(options.inputFile).json();
		if (options.operation === "recover") {
			return recoverWorkReview(reviewRuntime, workReviewRecoverSchema.parse(input));
		}
		const decision = workReviewRecordSchema.parse(input);
		const candidate = await authorizeWorkReview(reviewRuntime, decision);
		return recordWorkReview(reviewRuntime, decision, candidate);
	},
	add: (options) =>
		withDaemonLock(target(options), async () =>
			requestLazyServer(
				target(options),
				{
					kind: "add",
					repository: await resolveRepository(options.repo, options.beadsDb),
				},
				lifecycle,
			),
		),
	assessments: async (options) =>
		readAssessments(target(options).state, {
			limit: options.limit,
			repository: await resolveRepository(options.repo, options.beadsDb),
			request: options.request,
			source: options.source,
		}),
	config: async (options) =>
		requestServer(target(options), {
			command: await configurationCommand(options),
			kind: "config",
			repository: await resolveRepository(options.repo, options.beadsDb),
		}),
	events: async (options) =>
		readHistory(target(options).state, {
			failures: options.failures,
			repository: await resolveRepository(options.repo, options.beadsDb),
			request: options.request,
		}),
	explain: async (id, options) =>
		explainRequest(
			id,
			{ beads, repository: await resolveRepository(options.repo, options.beadsDb) },
			target(options),
		),
	init: initRepository,
	inspect: async (options) =>
		requestServer(target(options), {
			kind: "inspect",
			repository: await resolveRepository(options.repo, options.beadsDb),
		}),
	launch: async (id, options) => {
		const output = await execute(
			[...entryCommand(runtime), "launch", id, options.repo, options.beadsDb, options.state],
			process.cwd(),
			process.env,
		);
		return launchedResultSchema.parse(JSON.parse(output));
	},
	remove: async (options) =>
		requestServer(target(options), {
			kind: "remove",
			repository: await resolveRepository(options.repo, options.beadsDb),
		}),
	restart: (options) =>
		withDaemonLock(target(options), () => restartServer(target(options), lifecycle)),
	// eslint-disable-next-line max-statements -- Foreground process ownership includes signal forwarding and cleanup.
	serve: async (options) => {
		const selected = target(options);
		const child = Bun.spawn(
			[...entryCommand(runtime), "serve", "--socket", selected.socket, "--state", selected.state],
			{
				stderr: "pipe",
				stdin: "inherit",
				stdout: "pipe",
			},
		);
		const terminate = () => {
			child.kill("SIGTERM");
		};
		const interrupt = () => {
			child.kill("SIGINT");
		};
		process.once("SIGTERM", terminate);
		process.once("SIGINT", interrupt);
		const [stdout, stderr, code] = await Promise.all([
			foregroundOutput(child.stdout, process.stdout, options.json),
			foregroundOutput(child.stderr, process.stderr, options.json),
			child.exited,
		]);
		process.removeListener("SIGTERM", terminate);
		process.removeListener("SIGINT", interrupt);
		if (code !== SUCCESS) {
			throw new CommandError("Daemon", { code, stderr, stdout });
		}
	},
	sleep: async (options) =>
		requestServer(target(options), {
			kind: "sleep",
			repository: await resolveRepository(options.repo, options.beadsDb),
		}),
	status: (options) => requestServer(target(options), { kind: "status" }),
	stderr: (text) => process.stderr.write(text),
	stdout: (text) => process.stdout.write(text),
	stop: (options) => requestServer(target(options), { kind: "stop" }),
	wake: (options) =>
		withDaemonLock(target(options), async () =>
			requestLazyServer(
				target(options),
				{
					kind: "wake",
					repository: await resolveRepository(options.repo, options.beadsDb),
					temporary: options.temp,
				},
				lifecycle,
			),
		),
});

function target(options: ServerOptions): ServerTarget {
	return resolveServerTarget(options, runtime);
}

function configurationCommand(options: ConfigOptions): ConfigCommand | Promise<ConfigCommand> {
	return match(options)
		.returnType<ConfigCommand | Promise<ConfigCommand>>()
		.with({ operation: "show" }, () => ({ operation: "show" }))
		.with({ operation: "history" }, () => ({ operation: "history" }))
		.with({ operation: "reset" }, ({ actor }) => ({ actor, operation: "reset" }))
		.with({ operation: "update" }, async ({ actor, file }) => ({
			actor,
			change: policyChangeSchema.parse(await Bun.file(file).json()),
			operation: "update",
		}))
		.exhaustive();
}

async function foregroundOutput(
	stream: ReadableStream<Uint8Array>,
	destination: NodeJS.WriteStream,
	json: boolean,
): Promise<string> {
	if (json) {
		return new Response(stream).text();
	}
	for await (const chunk of stream) {
		destination.write(chunk);
	}
	return "";
}
