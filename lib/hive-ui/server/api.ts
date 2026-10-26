import {
	ANNOTATION_BATCH,
	PAGE_SIZE,
	boardFilterSchema,
	boardScopeSchema,
	inventoryFilterSchema,
} from "../contracts.ts";
import {
	nativeWorkflowState,
	readWorkflowControl,
	workflowOutcomeLabelsCurrent,
	workflowSimulationRequestSchema,
} from "@hive/shared";
import type { BeadsService } from "@hive/beads";
import type { Colony } from "../contracts.ts";
import type { createBoardData } from "./data.ts";
import type { createWorkflowTools } from "./workflow.ts";
import { z } from "zod";

const HTTP = {
	badRequest: 400,
	missing: 404,
	ok: 200,
	readOnly: 405,
	unavailable: 503,
};
const idSchema = z.string().regex(/^[\da-z][\w.-]*$/iu);
const apiRoute = new RegExp(
	/^\/api\/colonies\/(?<colony>[^/]+)\//u.source +
		/(?<operation>board|beads|provenance|inventory|outline|hierarchy|annotations|workflow)(?:\/(?<id>[^/]+))?/u
			.source +
		/(?<simulation>\/simulate)?$/u.source,
	"u",
);

// eslint-disable-next-line max-statements -- Keep HTTP outcome and telemetry around every route, including failures.
export async function api(
	request: Request,
	{
		beads,
		colonies,
		data,
		log,
		host,
		workflow,
	}: {
		workflow: ReturnType<typeof createWorkflowTools>;
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
		if (host === "127.0.0.1" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			status = HTTP.badRequest;
			throw new Error("Use the local UI address.");
		}
		if (url.pathname === "/api/colonies") {
			if (request.method !== "GET") {
				status = HTTP.readOnly;
				throw new Error("This operation does not support that HTTP method.");
			}
			return respond({ colonies });
		}
		const route = apiRoute.exec(url.pathname)?.groups;
		const selected = colonies.find((entry) => entry.id === route?.["colony"]);
		if (
			!route ||
			!selected ||
			(route["simulation"] !== undefined && route["operation"] !== "workflow")
		) {
			status = HTTP.missing;
			throw new Error("Unknown API route or colony.");
		}
		const simulation = route["operation"] === "workflow" && route["simulation"] !== undefined;
		let method = "GET";
		if (simulation) {
			method = "POST";
		}
		if (request.method !== method) {
			status = HTTP.readOnly;
			throw new Error("This operation does not support that HTTP method.");
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
			if (!simulation && url.searchParams.get("outcomeOnly") === "true") {
				return respond(
					await data.workflow(context, id, async (endpoint, runId) => {
						const selectedScope = { cwd: endpoint.root, db: endpoint.beadsDb };
						const run = await beads.show(selectedScope, runId);
						const { checkpoint, control } = await readWorkflowControl(beads, selectedScope, run);
						const outcome = nativeWorkflowState(run, { runId, scope: "run" }, control);
						return {
							runId,
							nativeStatus: run.status,
							updatedAt: run.updated_at,
							checkpoint: checkpoint.id,
							savedAt: checkpoint.updated_at,
							completion: control.completions[runId] ?? null,
							outcome,
							labelsCurrent: workflowOutcomeLabelsCurrent(run.labels, outcome),
						};
					}),
				);
			}
			if (simulation) {
				status = HTTP.badRequest;
				const input = workflowSimulationRequestSchema.parse(await request.json());
				status = HTTP.ok;
				return respond(
					await data.workflow(context, id, (endpoint, runId) =>
						workflow.simulate(endpoint, runId, input),
					),
				);
			}
			status = HTTP.badRequest;
			const checkpointOnly = z
				.enum(["true", "false"])
				.parse(url.searchParams.get("checkpointOnly") ?? "false");
			status = HTTP.ok;
			if (checkpointOnly === "true") {
				return respond(await data.workflow(context, id, workflow.checkpoint));
			}
			return respond(await data.workflow(context, id, workflow.preview));
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
