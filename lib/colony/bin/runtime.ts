#!/usr/bin/env bun
import { execute, resolveRepository } from "@hive/shared";
import { loadColonyActivity, serve } from "../src/server.ts";
import { createNativeBeads } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Workflow inputs are files in private daemon state.
import { join } from "node:path";
import { launch } from "../src/launch.ts";
import { match } from "ts-pattern";
import { nurseCommands } from "../src/nurse-commands.ts";
import { version } from "../package.json";
import { workReviewCommands } from "../src/work-review-commands.ts";
import { z } from "zod";

const USER_ARGUMENTS_START = 2;
const VERSION_ARGUMENT_COUNT = 3;
const SUCCESS = 0;
if (Bun.argv.length === VERSION_ARGUMENT_COUNT && Bun.argv[USER_ARGUMENTS_START] === "--version") {
	console.log(version);
	process.exit(SUCCESS);
}
const beads = createNativeBeads();
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
			console.log(JSON.stringify(await launch({ ...endpoint, beads, id, state })));
		})
		.with({ kind: "serve" }, ({ socket, state }) =>
			serve({ socket, state }, beads, {
				loadActivity: loadColonyActivity,
				nurse: nurseCommands({
					execute: (argv, cwd) => execute(argv, cwd, process.env),
					writeInput: async (token, input) => {
						const path = join(state, "nurse", `${token}.json`);
						await Bun.write(path, input);
						return path;
					},
				}),
				workReview: workReviewCommands(
					{
						execute: (argv, cwd) => execute(argv, cwd, process.env),
						writeInput: async (token, input) => {
							const path = join(state, "work-review", `${token}.json`);
							await Bun.write(path, input);
							return path;
						},
					},
					state,
				),
			}),
		)
		.exhaustive();
} catch (error) {
	if (error instanceof Error) {
		console.error(error.message);
	} else {
		console.error(String(error));
	}
	process.exitCode = 1;
}
