#!/usr/bin/env bun
/* eslint-disable max-dependencies -- CLI composes daemon commands and independent read-only inspection boundaries. */
import { CommandError, execute, policyChangeSchema, resolveRepository } from "@hive/shared";
import type { ConfigOptions, ServerOptions } from "../src/cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve CLI paths at the boundary.
import { join, resolve } from "node:path";
import { requestLazyServer, requestServer } from "../src/client.ts";
import type { ConfigCommand } from "@hive/shared";
import type { ServerTarget } from "../src/client.ts";
import { explainRequest } from "../src/explain.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Decode executable URL paths.
import { fileURLToPath } from "node:url";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve the default user state directory at the CLI boundary.
import { homedir } from "node:os";
import { initRepository } from "../src/producer.ts";
import { launchedResultSchema } from "../src/output.ts";
import { match } from "ts-pattern";
import { readHistory } from "../src/history.ts";
import { runCli } from "../src/cli.ts";

const USER_ARGUMENTS_START = 2;
const SUCCESS = 0;
const runtime = fileURLToPath(new URL("runtime.ts", import.meta.url));
process.exitCode = await runCli(Bun.argv.slice(USER_ARGUMENTS_START), {
	add: async (options) =>
		requestLazyServer(target(options), {
			kind: "add",
			repository: await resolveRepository(options.repo, options.beadsDb),
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
		explainRequest(id, await resolveRepository(options.repo, options.beadsDb), target(options)),
	init: initRepository,
	inspect: async (options) =>
		requestServer(target(options), {
			kind: "inspect",
			repository: await resolveRepository(options.repo, options.beadsDb),
		}),
	launch: async (id, options) => {
		const output = await execute(
			[process.execPath, runtime, "launch", id, options.repo, options.beadsDb, options.state],
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
	// eslint-disable-next-line max-statements -- Foreground process ownership includes signal forwarding and cleanup.
	serve: async (options) => {
		const selected = target(options);
		const child = Bun.spawn(
			[process.execPath, runtime, "serve", "--socket", selected.socket, "--state", selected.state],
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
	wake: async (options) =>
		requestLazyServer(target(options), {
			kind: "wake",
			repository: await resolveRepository(options.repo, options.beadsDb),
			temporary: options.temp,
		}),
});

function target(options: ServerOptions): ServerTarget {
	if (options.socket !== undefined && options.state === undefined) {
		throw new Error("--socket requires an explicit --state directory");
	}
	const userState = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state");
	const state = resolve(options.state ?? join(userState, "hive", "colony"));
	return {
		runtimeEntry: runtime,
		socket: resolve(options.socket ?? join(state, "colony.sock")),
		state,
	};
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
