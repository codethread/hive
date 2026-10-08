#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve explicitly configured local repository endpoints.
import { basename, resolve } from "node:path";
import { boardFilterSchema, boardScopeSchema } from "../contracts.ts";
import type { Colony } from "../contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit machine-mode diagnostics file boundary.
import { appendFile } from "node:fs/promises";
import { createBoardData } from "./data.ts";
import index from "../src/index.html";
import { resolveRepository } from "@hive/shared";
import { z } from "zod";

const HTTP = {
	badRequest: 400,
	forbidden: 403,
	missing: 404,
	ok: 200,
	readOnly: 405,
	unavailable: 503,
};
const MAX_PORT = 65_535;
const ENDPOINT_ID_LENGTH = 16;
const configSchema = z
	.array(z.object({ beadsDb: z.string().min(1), name: z.string().min(1), root: z.string().min(1) }))
	.min(1);
const optionsSchema = z.object({
	beadsDb: z.string().optional(),
	colonies: z.string().optional(),
	json: z.boolean().default(false),
	logFile: z.string().optional(),
	port: z.coerce.number().int().min(0).max(MAX_PORT),
	repo: z.string(),
});
const idSchema = z.string().regex(/^[\da-z][\w.-]*$/iu);

await main();

/** A foreground read-only app; no daemon lifecycle or tracker mutation commands. */
// eslint-disable-next-line max-statements -- Own startup, structured CLI failure and shutdown in one foreground boundary.
async function main(): Promise<void> {
	const program = new Command()
		.name("hive-ui")
		.description("Serve the local read-only Beads and Bees work board")
		.option("--repo <directory>", "Repository discovery directory", ".")
		.option("--beads-db <path>", "Selected native Beads database", process.env["BEADS_DB"])
		.option(
			"--colonies <file>",
			"JSON array of {name, root, beadsDb}; replaces the single endpoint",
		)
		.option("--port <number>", "Loopback HTTP port (0 chooses a free port)", "4318")
		.option("--json", "Emit one JSON startup result (requires --log-file)")
		.option("--log-file <path>", "Write server/native diagnostics to this file instead of stderr")
		.addHelpText(
			"after",
			"\nRun from lib/hive-ui with bun run start. No daemon is started. Each browser view selects exactly one configured endpoint.",
		)
		.configureOutput({ writeErr: () => {} })
		.exitOverride();
	try {
		program.parse();
		const options = optionsSchema.parse(program.opts());
		if (options.json && options.logFile === undefined) {
			throw new Error("--json requires --log-file so diagnostics stay out of terminal output.");
		}
		let logFile: string | undefined = undefined;
		if (options.logFile !== undefined) {
			logFile = resolve(options.logFile);
			await appendFile(logFile, "");
		}
		const log = async (sample: object): Promise<void> => {
			const line = `${JSON.stringify(sample)}\n`;
			if (logFile !== undefined) {
				await appendFile(logFile, line);
				return;
			}
			process.stderr.write(line);
		};
		let development: false | { console: false; hmr: false } = false;
		if (!options.json) {
			development = { console: false, hmr: false };
		}
		const colonies = await readColonies(options);
		const data = createBoardData();
		const server = Bun.serve({
			development,
			hostname: "127.0.0.1",
			port: options.port,
			routes: { "/*": index, "/api/*": (request) => api(request, { colonies, data, log }) },
		});
		const ready = {
			colonies: colonies.length,
			kind: "ui_started",
			logFile,
			ok: true,
			url: server.url.href,
		};
		if (options.json) {
			process.stdout.write(`${JSON.stringify(ready)}\n`);
		} else {
			process.stdout.write(`Hive UI · ${ready.url}\n`);
		}
		process.once("SIGTERM", () => {
			void server.stop(true);
		});
		process.once("SIGINT", () => {
			void server.stop(true);
		});
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === 0) {
			return;
		}
		const message = errorMessage(error);
		if (process.argv.includes("--json")) {
			process.stdout.write(
				`${JSON.stringify({ kind: "error", message, ok: false, reason: "ui_start_failed" })}\n`,
			);
		} else {
			process.stderr.write(`hive-ui: ${message}\n`);
		}
		process.exitCode = 1;
	}
}

async function readColonies(options: z.infer<typeof optionsSchema>): Promise<Colony[]> {
	if (options.colonies !== undefined) {
		const entries = configSchema.parse(await Bun.file(resolve(options.colonies)).json());
		return Promise.all(
			entries.map(async (entry) =>
				colony(await resolveRepository(entry.root, entry.beadsDb), entry.name),
			),
		);
	}
	if (options.beadsDb === undefined) {
		throw new Error("Select --beads-db (or BEADS_DB), or provide --colonies.");
	}
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	return [colony(endpoint, basename(endpoint.root))];
}

function colony(endpoint: { root: string; beadsDb: string }, name: string): Colony {
	const id = new Bun.CryptoHasher("sha256")
		.update(JSON.stringify(endpoint))
		.digest("hex")
		.slice(0, ENDPOINT_ID_LENGTH);
	return { ...endpoint, id, name };
}

// eslint-disable-next-line max-statements -- Keep HTTP outcome and telemetry around every route, including failures.
async function api(
	request: Request,
	{
		colonies,
		data,
		log,
	}: {
		colonies: Colony[];
		data: ReturnType<typeof createBoardData>;
		log: (sample: object) => Promise<void>;
	},
): Promise<Response> {
	const requestId = crypto.randomUUID();
	const start = performance.now();
	const url = new URL(request.url);
	let status = HTTP.ok;
	let bytes = 0;
	let failure: string | undefined = undefined;
	const respond = (value: unknown): Response => {
		const text = JSON.stringify(value);
		bytes = new TextEncoder().encode(text).length;
		return new Response(text, {
			headers: {
				"cache-control": "no-store",
				"content-type": "application/json",
				"x-request-id": requestId,
			},
			status,
		});
	};
	try {
		if (request.method !== "GET") {
			status = HTTP.readOnly;
			throw new Error("This UI only supports read-only GET requests.");
		}
		if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			status = HTTP.forbidden;
			throw new Error("Use the local UI address.");
		}
		if (url.pathname === "/api/colonies") {
			return respond({ colonies });
		}
		const route =
			/^\/api\/colonies\/(?<colony>[^/]+)\/(?<operation>board|beads|provenance|inventory)(?:\/(?<id>[^/]+))?$/u.exec(
				url.pathname,
			)?.groups;
		const selected = colonies.find((entry) => entry.id === route?.["colony"]);
		if (!route || !selected) {
			status = HTTP.missing;
			throw new Error("Unknown API route or colony.");
		}
		const context = { colony: selected, log, requestId };
		if (route["operation"] === "board") {
			status = HTTP.badRequest;
			const filter = boardFilterSchema.parse(JSON.parse(url.searchParams.get("filter") ?? "{}"));
			status = HTTP.ok;
			return respond(await data.board(context, filter, url.searchParams.get("fresh") === "true"));
		}
		if (route["operation"] === "inventory") {
			status = HTTP.badRequest;
			const scope = boardScopeSchema.parse(JSON.parse(url.searchParams.get("scope") ?? "{}"));
			status = HTTP.ok;
			return respond(
				await data.inventory(context, scope, url.searchParams.get("fresh") === "true"),
			);
		}
		status = HTTP.badRequest;
		const id = idSchema.parse(decodeURIComponent(route["id"] ?? ""));
		const scope = boardScopeSchema.parse(JSON.parse(url.searchParams.get("scope") ?? "{}"));
		status = HTTP.ok;
		if (route["operation"] === "beads") {
			return respond(await data.detail(context, id, scope));
		}
		return respond(await data.provenance(context, id));
	} catch (error) {
		if (status === HTTP.ok) {
			status = HTTP.unavailable;
		}
		failure = errorMessage(error);
		return respond({ message: failure });
	} finally {
		const ms = Math.round(performance.now() - start);
		await log({ bytes, failure, ms, operation: url.pathname, requestId, scope: "server", status });
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
