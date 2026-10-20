/* eslint-disable max-statements -- Each test keeps its bounded publication trace and observable assertions together. */
import {
	RESPONSE_LABEL,
	ResponseError,
	getResponse,
	publishResponse,
	resolveResponse,
	searchResponses,
} from "./response-store.ts";
import type { ResponseContext, ResponseErrorReason } from "./response-store.ts";
import { beforeEach, expect, test } from "bun:test";
import type { CreateBead } from "@hive/beads";
import { createMemoryBeads } from "@hive/beads";
import { spawnRequestLabels } from "@hive/shared";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const scope = { cwd: "/fixture", actor: "worker" };
// eslint-disable-next-line init-declarations -- beforeEach creates an isolated producer for every test.
let context: ResponseContext & { taskId: string };

// A fresh producer is setup; publication and schema parsing stay inside each test.
beforeEach(async () => {
	context = await fixture();
});

test("publication files an independent record preserving body, links and producer state #test-65", async () => {
	const before = await context.beads.listProjected(scope, { ids: [context.taskId] }, [
		"status",
		"updated_at",
	]);
	const ready = await context.beads.ready(scope);
	const body = "\n# Full answer\n\nExact whitespace.\n";
	const published = await publishResponse(context, { taskId: context.taskId, body });
	const record = await getResponse(context, published.responseId);
	expect(record).toMatchObject({
		formatVersion: ONE,
		taskId: context.taskId,
		author: "worker",
		body,
		supersedes: [],
	});
	const artifact = await context.beads.show(scope, record.id);
	expect(artifact).toMatchObject({
		issue_type: "docs",
		status: "closed",
		owner: "ct",
		notes: "",
		labels: [RESPONSE_LABEL],
	});
	expect(artifact.assignee).toBeUndefined();
	expect(
		artifact.dependencies.map(({ id, dependency_type }) => ({ id, type: dependency_type })),
	).toEqual([{ id: context.taskId, type: "replies-to" }]);
	expect(
		await context.beads.listProjected(scope, { ids: [context.taskId] }, ["status", "updated_at"]),
	).toEqual(before);
	expect(await context.beads.ready(scope)).toEqual(ready);
	expect(await resolveResponse(context, { taskId: context.taskId })).toEqual({
		state: "available",
		responseIds: [record.id],
	});
});

test("repeats reuse identity and corrections preserve exact historical reads #test-66", async () => {
	const input = { taskId: context.taskId, body: "Original" };
	const first = await publishResponse(context, input);
	expect(await publishResponse(context, input)).toEqual({ ...first, effect: "existing" });
	await failure(publishResponse(context, { ...input, body: "Changed" }), "response_conflict");
	const correction = { ...input, body: "Corrected", supersedes: [first.responseId] };
	const second = await publishResponse(context, correction);
	expect(await publishResponse(context, correction)).toEqual({ ...second, effect: "existing" });
	const original = await getResponse(context, first.responseId);
	const corrected = await getResponse(context, second.responseId);
	expect(original.body).toBe("Original");
	expect(corrected.supersedes).toEqual([first.responseId]);
	expect(await resolveResponse(context, input)).toEqual({
		state: "available",
		responseIds: [second.responseId],
	});
	const docs = await context.beads.list(scope, { all: true, labels: [RESPONSE_LABEL] });
	expect(docs.issues).toHaveLength(TWO);
});

test("simultaneous publications remain ambiguous until an explicit correction names every head #test-67", async () => {
	const gate = Promise.withResolvers<void>();
	let arrived = ZERO;
	const beads = {
		...context.beads,
		create: async (...args: Parameters<typeof context.beads.create>) => {
			arrived += ONE;
			if (arrived === TWO) {
				gate.resolve();
			}
			await gate.promise;
			return context.beads.create(...args);
		},
	};
	const publications = await Promise.all(
		["One", "Two"].map((body) =>
			publishResponse({ ...context, beads }, { taskId: context.taskId, body }),
		),
	);
	const responseIds = publications.map(({ responseId }) => responseId).toSorted();
	expect(await resolveResponse(context, context)).toEqual({ state: "ambiguous", responseIds });
	await failure(
		publishResponse(context, {
			taskId: context.taskId,
			body: "Correction",
			supersedes: [responseIds[ZERO]!],
		}),
		"response_conflict",
	);
	const corrected = await publishResponse(context, {
		taskId: context.taskId,
		body: "Correction",
		supersedes: responseIds,
	});
	expect(await resolveResponse(context, context)).toEqual({
		state: "available",
		responseIds: [corrected.responseId],
	});
});

test.each(["create", "readback"] as const)(
	"uncertain %s retains effects and a retry never duplicates",
	async (operation) => {
		const broken = { ...context.beads };
		if (operation === "create") {
			broken.create = async (...args) => {
				await context.beads.create(...args);
				throw new Error("Lost create receipt");
			};
		} else {
			broken.listProjected = () => Promise.reject(new Error("Readback unavailable"));
		}
		const input = { taskId: context.taskId, body: "Durable despite interruption" };
		const error = await failure(
			publishResponse({ ...context, beads: broken }, input),
			"response_publish_uncertain",
		);
		expect(error.uncertainOperation).toBe(operation);
		const repeated = await publishResponse(context, input);
		expect(repeated.effect).toBe("existing");
		if (operation === "readback") {
			expect(error.responseIds).toEqual([repeated.responseId]);
			expect(error.confirmedEffects).toEqual([
				{ operation: "create", responseId: repeated.responseId },
			]);
		} else {
			expect(error.confirmedEffects).toEqual([]);
		}
		const records = await context.beads.list(scope, { all: true, labels: [RESPONSE_LABEL] });
		expect(records.issues).toHaveLength(ONE);
	},
);

test.each([
	{ description: "not json", status: "closed", linked: true },
	{ description: "document", status: "open", linked: true },
	{ description: "document", status: "closed", linked: false },
])("tagged malformed record $description/$status/$linked fails explicitly", async (input) => {
	let text: string = input.description;
	if (text === "document") {
		text = JSON.stringify({
			formatVersion: ONE,
			taskId: context.taskId,
			author: "worker",
			body: "Report",
			supersedes: [],
		});
	}
	const deps = [];
	if (input.linked) {
		deps.push({ id: context.taskId, type: "replies-to" });
	}
	const record = await context.beads.create(scope, {
		title: "Malformed",
		type: "docs",
		status: input.status,
		labels: [RESPONSE_LABEL],
		description: text,
		deps,
	});
	await failure(getResponse(context, record.id), "invalid_response");
	if (input.linked) {
		await failure(resolveResponse(context, context), "invalid_response");
	}
});

test("unknown response is explicit while an empty task resolution is missing", async () => {
	await failure(getResponse(context, "unknown"), "response_missing");
	expect(await resolveResponse(context, context)).toEqual({ state: "missing", responseIds: [] });
});

test.each([
	{ assignee: "someone-else", labels: [], reason: "response_reserved" },
	{ assignee: "ct", labels: [], reason: "response_reserved" },
	{ assignee: "worker", labels: ["hitl"], reason: "response_reserved" },
	{ assignee: "worker", labels: ["system"], reason: "invalid_response_target" },
] as const)(
	"publication preserves $assignee/$labels reservation #test-503",
	async ({ assignee, labels, reason }) => {
		await context.beads.update(scope, [context.taskId], { assignee, labels });
		await failure(publishResponse(context, { taskId: context.taskId, body: "Report" }), reason);
		const records = await context.beads.list(scope, { all: true, labels: [RESPONSE_LABEL] });
		expect(records.issues).toEqual([]);
	},
);

test.each(["driver", "stage"] as const)(
	"managed %s validates identity and exact completion anchor #test-68",
	async (kind) => {
		const request = await managedRequest(context, kind);
		await context.beads.close(scope, context.taskId, { reason: "done" });
		const response = await publishResponse(context, {
			taskId: context.taskId,
			requestId: request.id,
			body: "Completed",
		});
		const record = await getResponse(context, response.responseId);
		expect(record.requestId).toBe(request.id);
		const other = await context.beads.create(scope, { title: "Different anchor" });
		await failure(
			publishResponse(context, { taskId: other.id, requestId: request.id, body: "Wrong" }),
			"invalid_response_request",
		);
		await failure(
			publishResponse(
				{ ...context, scope: { ...scope, actor: "foreign" } },
				{ taskId: other.id, requestId: request.id, body: "Wrong" },
			),
			"invalid_response_request",
		);
	},
);

test("new retry requests have distinct lineages and cannot supersede historical results", async () => {
	const oldRequest = await managedRequest(context, "driver");
	const newRequest = await managedRequest(context, "driver");
	const first = await publishResponse(context, {
		taskId: context.taskId,
		requestId: oldRequest.id,
		body: "Earlier",
	});
	await failure(
		publishResponse(context, {
			taskId: context.taskId,
			requestId: newRequest.id,
			body: "Retry",
			supersedes: [first.responseId],
		}),
		"response_conflict",
	);
	const second = await publishResponse(context, {
		taskId: context.taskId,
		requestId: newRequest.id,
		body: "Retry",
	});
	expect(
		await resolveResponse(context, { taskId: context.taskId, requestId: oldRequest.id }),
	).toEqual({ state: "available", responseIds: [first.responseId] });
	expect(await resolveResponse(context, context)).toEqual({
		state: "ambiguous",
		responseIds: [first.responseId, second.responseId].toSorted(),
	});
});

test(
	"search returns bounded filed summaries with independent continuation and no body " +
		"hydration #test-518",
	async () => {
		const first = await publishResponse(context, {
			taskId: context.taskId,
			body: "needle original",
		});
		await publishResponse(context, {
			taskId: context.taskId,
			body: "needle correction",
			supersedes: [first.responseId],
		});
		await context.beads.create(scope, {
			title: "needle system",
			status: "closed",
			labels: [RESPONSE_LABEL, "system"],
		});
		const beads = {
			...context.beads,
			show: () => Promise.reject(new Error("No hydration")),
			dep: { ...context.beads.dep, list: () => Promise.reject(new Error("No detail reads")) },
		};
		const page = await searchResponses(
			{ ...context, beads },
			{ query: "needle", limit: ONE, offset: ZERO },
		);
		expect(page.items).toHaveLength(ONE);
		expect(Object.keys(page.items[ZERO]!).toSorted()).toEqual([
			"createdAt",
			"responseId",
			"source",
			"title",
		]);
		expect(page.hasMore).toBe(true);
		expect(page.nextOffset).toBe(ONE);
		const end = await searchResponses(context, { query: "needle", limit: ONE, offset: TWO });
		expect(end.items).toEqual([]);
		expect(end.hasMore).toBe(false);
		expect(end.nextOffset).toBeNull();
	},
);

// --- Private functions ---
async function fixture(): Promise<ResponseContext & { taskId: string }> {
	const beads = createMemoryBeads();
	const task = await beads.create(scope, { title: "Producer", owner: "ct", assignee: "worker" });
	return { beads, scope, taskId: task.id };
}
async function failure(
	promise: Promise<unknown>,
	reason: ResponseErrorReason,
): Promise<ResponseError> {
	const result = await promise.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(ResponseError);
	if (!(result instanceof ResponseError)) {
		throw new Error("Expected a ResponseError");
	}
	expect(result.reason).toBe(reason);
	return result;
}
function managedRequest(producer: ResponseContext & { taskId: string }, kind: "driver" | "stage") {
	let assignment: object = { kind, runId: producer.taskId };
	if (kind === "stage") {
		assignment = { kind, runId: "outer-run", stageId: producer.taskId };
	}
	const input: CreateBead = {
		title: "Managed request",
		assignee: "worker",
		labels: spawnRequestLabels("worker"),
		description: JSON.stringify({
			harness: "codex",
			kind: "worker",
			model: "fixture",
			effort: "low",
			cwd: scope.cwd,
			assignment,
		}),
		deps: [{ id: producer.taskId, type: "related" }],
	};
	return producer.beads.create(scope, input);
}
