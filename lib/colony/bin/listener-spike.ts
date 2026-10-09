#!/usr/bin/env bun
import { listListenerSpikes, runListenerSpike } from "../src/listener-spike.ts";
import { Command } from "commander";

const FAILURE = 1;
const cli = new Command()
	.name("listener-spike")
	.description("Run the event-listener proofs of concept independently of Colony");
cli
	.command("list")
	.requiredOption("--repo <path>", "Checkout containing .hive/listeners")
	.action(async (options: { repo: string }) => {
		console.log(
			JSON.stringify({
				ok: true,
				kind: "listener_catalogue",
				listeners: await listListenerSpikes(options.repo),
			}),
		);
	});
cli
	.command("run <name>")
	.requiredOption("--repo <path>", "Checkout containing .hive/listeners")
	.requiredOption("--config <path>", "JSON connection, selection, checkpoint and output settings")
	.action(async (name: string, options: { repo: string; config: string }) => {
		const controller = new AbortController();
		const stop = () => controller.abort();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		try {
			await runListenerSpike(
				options.repo,
				name,
				await Bun.file(options.config).json(),
				controller.signal,
			);
		} catch (error) {
			if (!controller.signal.aborted) {
				throw error;
			}
		} finally {
			process.removeListener("SIGINT", stop);
			process.removeListener("SIGTERM", stop);
		}
	});

try {
	await cli.parseAsync();
} catch (error) {
	console.log(
		JSON.stringify({
			ok: false,
			kind: "listener_failed",
			reason: "listener_failed",
			message: String(error),
		}),
	);
	process.exitCode = FAILURE;
}
