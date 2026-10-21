#!/usr/bin/env bun
/* eslint-disable max-dependencies -- CLI composes daemon commands and independent read-only inspection boundaries. */
import { CommandError, createNativeBeads } from "@hive/beads";
import type { ConfigOptions, ServerOptions } from "../src/cli.ts";
import { colonyEntry, entryCommand } from "../src/executables.ts";
import { execute, policyChangeSchema, resolveRepository } from "@hive/shared";
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
import type { DaemonLifecycle } from "../src/daemon-lifecycle.ts";
import type { ServerTarget } from "../src/client.ts";
import { explainRequest } from "../src/explain.ts";
import { initRepository } from "../src/producer.ts";
import { launchctlResult } from "../src/daemon-launchd.ts";
import { launchedResultSchema } from "../src/output.ts";
import { match } from "ts-pattern";
import { observeProcess } from "../src/processes.ts";
import { readHistory } from "../src/history.ts";
import { requestServer } from "../src/client.ts";
import { resolveServerTarget } from "../src/server-target.ts";
import { runCli } from "../src/cli.ts";

const USER_ARGUMENTS_START = 2;
const POLL_INTERVAL_MS = 50;
const beads = createNativeBeads();
const SUCCESS = 0;
const runtime = colonyEntry("runtime");
const lifecycle: DaemonLifecycle = {
	prepare: (selected) => prepareSupervisedServer(selected, launchctlResult),
	handoff: readDaemonHandoff,
	pending: readPendingRestart,
	record: recordRestart,
	request: requestServer,
	owner: readDaemonOwner,
	observe: observeProcess,
	start: (selected, effect) => startSupervisedServer(selected, effect, launchctlResult),
	supervisor: selectedSupervisor,
	verify: (selected, status, supervisor) =>
		verifySupervisedServer(selected, status, supervisor, launchctlResult),
	now: () => performance.now(),
	pause: () => Bun.sleep(POLL_INTERVAL_MS),
};
process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	executionClearance: async (scope, options) => {
		const result = await requestServer(target(options), {
			kind: "execution-clearance",
			scope,
			repository: await resolveRepository(options.repo, options.beadsDb),
		});
		if (result.kind !== "execution-clearance") {
			throw new Error("Expected execution clearance");
		}
		return result;
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
	restart: (options) => {
		let mode: "inplace" | "replace-retained" = "inplace";
		if (options.replaceRetained) {
			mode = "replace-retained";
		}
		return withDaemonLock(target(options), () => restartServer(target(options), lifecycle, mode));
	},
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
