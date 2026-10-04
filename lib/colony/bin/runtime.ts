#!/usr/bin/env bun
import { launch } from "../src/launch.ts";
import { match } from "ts-pattern";
import { resolveRepository } from "@hive/shared";
import { serve } from "../src/server.ts";
import { z } from "zod";

const USER_ARGUMENTS_START = 2;
const SOCKET_ARGUMENT = 2;
const STATE_ARGUMENT = 4;
const commandSchema = z.union([
	z
		.tuple([z.literal("launch"), z.string(), z.string(), z.string(), z.string()])
		.transform(([, id, repo, database, state]) => ({
			database,
			id,
			kind: "launch" as const,
			repo,
			state,
		})),
	z
		.tuple([
			z.literal("serve"),
			z.literal("--socket"),
			z.string(),
			z.literal("--state"),
			z.string(),
		])
		.transform((args) => ({
			kind: "serve" as const,
			socket: args[SOCKET_ARGUMENT],
			state: args[STATE_ARGUMENT],
		})),
]);
try {
	const command = commandSchema.parse(Bun.argv.slice(USER_ARGUMENTS_START));
	await match(command)
		.with({ kind: "launch" }, async ({ id, repo, database, state }) => {
			const endpoint = await resolveRepository(repo, database);
			console.log(JSON.stringify(await launch({ ...endpoint, id, state })));
		})
		.with({ kind: "serve" }, ({ socket, state }) => serve({ socket, state }))
		.exhaustive();
} catch (error) {
	if (error instanceof Error) {
		console.error(error.message);
	} else {
		console.error(String(error));
	}
	process.exitCode = 1;
}
