#!/usr/bin/env bun
/* eslint-disable import/max-dependencies -- Foreground boundary composes server, CLI and native reads. */
import {
	ANNOTATION_BATCH,
	PAGE_SIZE,
	boardFilterSchema,
	boardScopeSchema,
	inventoryFilterSchema,
} from "../contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve explicitly configured local repository endpoints.
import { basename, resolve } from "node:path";
import { execute, resolveRepository } from "@hive/shared";
import type { BeadsService } from "@hive/beads";
import type { Colony } from "../contracts.ts";
import { CommanderError } from "commander";
import type { UiOptions } from "./cli.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit machine-mode diagnostics file boundary.
import { appendFile } from "node:fs/promises";
import { createBoardData } from "./data.ts";
import { createNativeBeads } from "@hive/beads";
import { createTopologyReader } from "./topology.ts";
import { createUiCommand } from "./cli.ts";
import { createWorkflowReader } from "./workflow.ts";
import { discoverColonies } from "./colony-discovery.ts";
import index from "../src/index.html";
import { readStatuses } from "./statuses.ts";
import { z } from "zod";

const HTTP = {
	badRequest: 400,
	missing: 404,
	ok: 200,
	readOnly: 405,
	unavailable: 503,
};
const ENDPOINT_ID_LENGTH = 16;
const configSchema = z
	.array(z.object({ beadsDb: z.string().min(1), name: z.string().min(1), root: z.string().min(1) }))
	.min(1);
const idSchema = z.string().regex(/^[\da-z][\w.-]*$/iu);
const apiRoute = new RegExp(
	/^\/api\/colonies\/(?<colony>[^/]+)\//u.source +
		/(?<operation>board|beads|provenance|inventory|outline|hierarchy|annotations|workflow)(?:\/(?<id>[^/]+))?$/u
			.source,
	"u",
);

await main();

/** A foreground read-only app; no daemon lifecycle or tracker mutation commands. */
// eslint-disable-next-line max-statements
async function main(): Promise<void> {
	const program = createUiCommand({
		beadsDb: process.env["BEADS_DB"],
		start: startServer,
		write: (output) => {
			process.stdout.write(output);
		},
	});
	try {
		await program.parseAsync();
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === 0) {
			return;
		}
		const message = errorMessage(error);
		let reason = "ui_start_failed";
		if (program.args[0] === "changelog") {
			reason = "changelog_failed";
		}
		if (process.argv.includes("--json")) {
			process.stdout.write(`${JSON.stringify({ kind: "error", message, ok: false, reason })}\n`);
		} else {
			process.stderr.write(`hive-ui: ${message}\n`);
		}
		process.exitCode = 1;
	}
}

// --- Private helpers ---

// eslint-disable-next-line max-statements -- Keep server startup, diagnostics and shutdown in one foreground boundary.
async function startServer(options: UiOptions): Promise<void> {
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
	const invoke = (argv: string[], cwd: string) => execute(argv, cwd, process.env);
	const colonies = await readColonies(options, invoke);
	const beads = createNativeBeads();
	const data = createBoardData(createTopologyReader({ beads, execute: invoke }));
	const preview = createWorkflowReader(invoke);
	const server = Bun.serve({
		development,
		hostname: options.host,
		port: options.port,
		routes: {
			"/*": index,
			"/api/*": (request, listener) => {
				listener.timeout(request, 0);
				return api(request, { beads, colonies, data, log, preview, host: options.host });
			},
		},
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
}

// eslint-disable-next-line max-statements -- Select one startup source and establish the server endpoint allowlist.
async function readColonies(
	options: UiOptions,
	invoke: (argv: string[], cwd: string) => Promise<string>,
): Promise<Colony[]> {
	if (options.daemon) {
		if (options.colonies !== undefined) {
			throw new Error("Choose --daemon or --colonies; they select different endpoint sources.");
		}
		const endpoints = await discoverColonies(options, (argv) =>
			invoke(argv, resolve(options.repo)),
		);
		return Promise.all(
			endpoints.map(async (endpoint) =>
				colony(await resolveRepository(endpoint.root, endpoint.beadsDb), basename(endpoint.root)),
			),
		);
	}
	if (options.state !== undefined || options.socket !== undefined) {
		throw new Error("--state and --socket require --daemon.");
	}
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
	return [await colony(endpoint, basename(endpoint.root))];
}

async function colony(endpoint: { root: string; beadsDb: string }, name: string): Promise<Colony> {
	const id = new Bun.CryptoHasher("sha256")
		.update(JSON.stringify(endpoint))
		.digest("hex")
		.slice(0, ENDPOINT_ID_LENGTH);
	return { ...endpoint, id, name, statuses: await readStatuses(endpoint.beadsDb) };
}

// eslint-disable-next-line max-statements -- Keep HTTP outcome and telemetry around every route, including failures.
async function api(
	request: Request,
	{
		beads,
		colonies,
		data,
		log,
		host,
		preview,
	}: {
		preview: ReturnType<typeof createWorkflowReader>;
		host: string;
		beads: BeadsService;
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
		if (host === "127.0.0.1" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			status = HTTP.badRequest;
			throw new Error("Use the local UI address.");
		}
		if (url.pathname === "/api/colonies") {
			return respond({ colonies });
		}
		const route = apiRoute.exec(url.pathname)?.groups;
		const selected = colonies.find((entry) => entry.id === route?.["colony"]);
		if (!route || !selected) {
			status = HTTP.missing;
			throw new Error("Unknown API route or colony.");
		}
		status = HTTP.badRequest;
		const refreshAfter = z.coerce
			.number()
			.int()
			.nonnegative()
			.parse(url.searchParams.get("refreshAfter") ?? 0);
		const context = { beads, colony: selected, log, requestId };
		if (route["operation"] === "board") {
			status = HTTP.badRequest;
			const filter = boardFilterSchema.parse(JSON.parse(url.searchParams.get("filter") ?? "{}"));
			status = HTTP.ok;
			return respond(await data.board(context, filter, refreshAfter));
		}
		if (route["operation"] === "inventory") {
			status = HTTP.badRequest;
			const filter = inventoryFilterSchema.parse(
				JSON.parse(url.searchParams.get("filter") ?? "{}"),
			);
			status = HTTP.ok;
			return respond(await data.inventory(context, filter, refreshAfter));
		}
		if (route["operation"] === "hierarchy" || route["operation"] === "annotations") {
			let limit = ANNOTATION_BATCH;
			if (route["operation"] === "hierarchy") {
				limit = PAGE_SIZE;
			}
			const ids = z
				.array(idSchema)
				.max(limit)
				.parse(JSON.parse(url.searchParams.get("ids") ?? "[]"));
			status = HTTP.ok;
			if (route["operation"] === "hierarchy") {
				return respond(await data.hierarchy(context, ids, refreshAfter));
			}
			return respond(await data.annotations(context, ids, refreshAfter));
		}
		status = HTTP.badRequest;
		const id = idSchema.parse(decodeURIComponent(route["id"] ?? ""));
		const scope = boardScopeSchema.parse(JSON.parse(url.searchParams.get("scope") ?? "{}"));
		status = HTTP.ok;
		if (route["operation"] === "workflow") {
			return respond(await data.workflow(context, id, preview));
		}
		if (route["operation"] === "outline") {
			return respond(await data.outline(context, id, refreshAfter));
		}
		if (route["operation"] === "beads") {
			return respond(await data.detail(context, id, { scope, refreshAfter }));
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
