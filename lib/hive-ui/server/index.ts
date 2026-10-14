#!/usr/bin/env bun
/* eslint-disable import/max-dependencies -- Application entry composes native/file adapters and the HTTP contract. */
import { Command, CommanderError } from "commander";
import {
	PAGE_SIZE,
	boardFilterSchema,
	boardScopeSchema,
	inventoryFilterSchema,
} from "../contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve explicitly configured local repository endpoints.
import { basename, resolve } from "node:path";
import { createLogData, readRetainedLog } from "./logs.ts";
import { execute, resolveRepository } from "@hive/shared";
import type { BeadsService } from "@hive/beads";
import type { Colony } from "../contracts.ts";
import type { InspectionTarget } from "./log-inspection.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit machine-mode diagnostics file boundary.
import { appendFile } from "node:fs/promises";
import { createBoardData } from "./data.ts";
import { createColonyInspector } from "./log-inspection.ts";
import { createNativeBeads } from "@hive/beads";
import index from "../src/index.html";
import { logQuerySchema } from "../log-contracts.ts";
import { readStatuses } from "./statuses.ts";
import { z } from "zod";

const HTTP = {
	badRequest: 400,
	missing: 404,
	ok: 200,
	readOnly: 405,
	unavailable: 503,
};
const MAX_PORT = 65_535;
const ENDPOINT_ID_LENGTH = 16;
const inspectionPathSchema = z
	.string()
	.min(1)
	.transform((path) => resolve(path));
const inspectionTargetSchema = z
	.object({ state: inspectionPathSchema.optional(), socket: inspectionPathSchema.optional() })
	.refine(
		(value) => value.socket === undefined || value.state !== undefined,
		"A socket requires explicit state.",
	);
const configSchema = z
	.array(
		z.object({
			beadsDb: z.string().min(1),
			name: z.string().min(1),
			root: z.string().min(1),
			inspection: inspectionTargetSchema.default({}),
		}),
	)
	.min(1);
interface ConfiguredColony extends Colony {
	/** Server-owned inspection selection, never a browser filesystem input. */
	inspection: InspectionTarget;
}
const optionsSchema = z.object({
	beadsDb: z.string().optional(),
	colonies: z.string().optional(),
	host: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
	json: z.boolean().default(false),
	logFile: z.string().optional(),
	port: z.coerce.number().int().min(0).max(MAX_PORT),
	repo: z.string(),
	state: z.string().min(1).optional(),
	socket: z.string().min(1).optional(),
});
const idSchema = z.string().regex(/^[\da-z][\w.-]*$/iu);
const apiRoute = new RegExp(
	/^\/api\/colonies\/(?<colony>[^/]+)\//u.source +
		/(?<operation>board|beads|provenance|inventory|outline|hierarchy|logs)(?:\/(?<id>[^/]+))?$/u
			.source,
	"u",
);

await main();

/** A foreground read-only app; no daemon lifecycle or tracker mutation commands. */
// Own startup, structured CLI failure and shutdown in one foreground boundary.
// eslint-disable-next-line max-statements
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
		.option("--host <address>", "Bind address: 127.0.0.1 or 0.0.0.0 for LAN access", "127.0.0.1")
		.option("--port <number>", "HTTP port (0 chooses a free port)", "4318")
		.option("--json", "Emit one JSON startup result (requires --log-file)")
		.option("--log-file <path>", "Write server/native diagnostics to this file instead of stderr")
		.option("--state <directory>", "Existing Colony state selection for lazy log inspection")
		.option("--socket <path>", "Existing Colony socket for log inspection (requires --state)")
		.addHelpText(
			"after",
			"\nRun hive-ui, or use bun run start from lib/hive-ui during " +
				"development. No daemon is started. Each browser view selects exactly " +
				"one configured endpoint.",
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
		const beads = createNativeBeads();
		const server = Bun.serve({
			development,
			hostname: options.host,
			port: options.port,
			routes: {
				"/*": index,
				"/api/*": (request) => api(request, { beads, colonies, data, log, host: options.host }),
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

async function readColonies(options: z.infer<typeof optionsSchema>): Promise<ConfiguredColony[]> {
	if (options.colonies !== undefined) {
		const entries = configSchema.parse(await Bun.file(resolve(options.colonies)).json());
		return Promise.all(
			entries.map(async (entry) =>
				Object.assign(
					await colony(await resolveRepository(entry.root, entry.beadsDb), entry.name),
					{ inspection: entry.inspection },
				),
			),
		);
	}
	if (options.beadsDb === undefined) {
		throw new Error("Select --beads-db (or BEADS_DB), or provide --colonies.");
	}
	const endpoint = await resolveRepository(options.repo, options.beadsDb);
	const inspection = inspectionTargetSchema.parse({ state: options.state, socket: options.socket });
	return [{ ...(await colony(endpoint, basename(endpoint.root))), inspection }];
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
	}: {
		host: string;
		beads: BeadsService;
		colonies: ConfiguredColony[];
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
			return respond({ colonies: colonies.map(({ inspection: _inspection, ...entry }) => entry) });
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
		if (route["operation"] === "hierarchy") {
			const ids = z
				.array(idSchema)
				.max(PAGE_SIZE)
				.parse(JSON.parse(url.searchParams.get("ids") ?? "[]"));
			status = HTTP.ok;
			return respond(await data.hierarchy(context, ids, refreshAfter));
		}
		status = HTTP.badRequest;
		const id = idSchema.parse(decodeURIComponent(route["id"] ?? ""));
		if (route["operation"] === "logs") {
			const query = logQuerySchema.parse(Object.fromEntries(url.searchParams));
			const inspect = createColonyInspector(
				{
					execute: (argv, cwd) => execute(argv, cwd, process.env),
					log: (sample) => log({ ...sample, requestId }),
				},
				selected.inspection,
			);
			const read = createLogData({ inspect, read: readRetainedLog });
			status = HTTP.ok;
			return respond(await read(selected, id, query));
		}
		const scope = boardScopeSchema.parse(JSON.parse(url.searchParams.get("scope") ?? "{}"));
		status = HTTP.ok;
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
