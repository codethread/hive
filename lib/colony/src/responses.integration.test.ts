/* eslint-disable max-statements -- Each test keeps the public command trace and its observable evidence together. */
/* eslint-disable unicorn/no-null -- Native snapshots distinguish unknown authorship from absent content. */
// Exercise real Commander commands, Colony orchestration and the Beads adapter together.
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import {
	findResponses,
	publishTaskResponse,
	readRequestResult,
	readResponseHistory,
	readTaskResponse,
} from "./responses.ts";
import type { BeadsService } from "@hive/beads";
import type { BeeDependencies } from "./bee-cli.ts";
import { inspectRequest } from "./requests.ts";
import { publishResponse } from "./response-store.ts";
import { runBeeCli } from "./bee-cli.ts";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const REPEAT = 1000;
const MAX_ACK_BYTES = 1024;
const BODY = "\n# Authored result\n\nExact report.\n".repeat(REPEAT);
const endpointOptions = { repo: "/fixture", beadsDb: "/fixture/tracker.db" };
const missing = await fixture();
const delivery = await fixture();
const history = await fixture();
const interrupted = await fixture();
const humanInterrupted = await fixture();

// Driver and stage requests deliberately share the same anchor but distinct identities.
const lineage = await fixture();
const stageId = await createSpawn(lineage.tracker, lineage.taskId, {
	description: JSON.stringify({
		assignment: { kind: "stage", runId: "outer-run", stageId: lineage.taskId },
		cwd: null,
		effort: "low",
		harness: "fixture",
		kind: "worker",
		model: "fixture",
		prompt: BODY,
		system_prompt: BODY,
	}),
});
const context = {
	beads: lineage.tracker.beads,
	scope: trackerScope(lineage.tracker.repository, "worker"),
};
const old = await publishResponse(context, {
	taskId: lineage.taskId,
	requestId: lineage.requestId,
	body: "Old driver result",
});
const stage = await publishResponse(context, {
	taskId: lineage.taskId,
	requestId: stageId,
	body: "Stage result",
});
await lineage.tracker.beads.close(context.scope, lineage.requestId, { reason: "blocked" });
await lineage.tracker.beads.dep.add(context.scope, stageId, lineage.requestId, "supersedes");

test("managed publication preserves the complete body and returns only its confirmed identity", async () => {
	const result = await delivery.invoke([
		"response",
		"publish",
		delivery.taskId,
		"--body-file",
		"answer.md",
		"--actor",
		"worker",
		"--json",
	]);
	expect(result.code).toBe(ZERO);
	const published = JSON.parse(result.stdout);
	expect(published).toMatchObject({
		ok: true,
		kind: "response_published",
		requestId: delivery.requestId,
		taskId: delivery.taskId,
		effect: "created",
	});
	expect(result.stdout.length).toBeLessThan(MAX_ACK_BYTES);
	expect(result.stdout).not.toContain("Authored result");
	const repeated = await delivery.invoke([
		"response",
		"publish",
		delivery.taskId,
		"--body-file",
		"answer.md",
		"--actor",
		"worker",
		"--json",
	]);
	expect(JSON.parse(repeated.stdout)).toMatchObject({
		responseId: published.responseId,
		effect: "existing",
	});
	const detail = await delivery.invoke(["response", "get", published.responseId, "--json"]);
	expect(JSON.parse(detail.stdout).response.body).toBe(BODY);
	const human = await delivery.invoke(["response", "get", published.responseId]);
	expect(human.stdout).toContain(BODY);
	expect(human.stdout).toContain(`request ${delivery.requestId}`);
	expect(human.stderr).toBe("");
});

test("result keeps exact driver/stage identity after supersession without task hydration or readiness", async () => {
	const beads: BeadsService = {
		...lineage.tracker.beads,
		show: unused,
		showMany: unused,
		ready: unused,
		comments: { ...lineage.tracker.beads.comments, list: unused },
	};
	const original = await lineage.invoke(["result", lineage.requestId, "--json"], beads);
	expect(original.code).toBe(ZERO);
	expect(JSON.parse(original.stdout)).toMatchObject({
		request: {
			id: lineage.requestId,
			taskId: lineage.taskId,
			role: "driver",
			outcome: "failed",
			closeReason: "blocked",
		},
		response: { id: old.responseId, body: "Old driver result" },
	});
	const worker = await lineage.invoke(["result", stageId, "--json"], beads);
	expect(JSON.parse(worker.stdout)).toMatchObject({
		request: { id: stageId, role: "stage", outcome: "pending" },
		response: { id: stage.responseId, body: "Stage result" },
	});
	expect(worker.stdout).not.toContain(BODY);
	expect(worker.stdout).not.toContain("recipe");
	expect(worker.stdout).not.toContain("comments");
	const ambiguous = await lineage.invoke(["response", "get", "--task", lineage.taskId, "--json"]);
	expect(ambiguous.code).toBe(ONE);
	expect(JSON.parse(ambiguous.stdout)).toMatchObject({
		ok: false,
		reason: "response_ambiguous",
		responseIds: [old.responseId, stage.responseId].toSorted(),
	});
	const selected = await lineage.invoke([
		"response",
		"get",
		"--task",
		lineage.taskId,
		"--request",
		stageId,
		"--json",
	]);
	expect(JSON.parse(selected.stdout).response.id).toBe(stage.responseId);
});

test("missing response fails in JSON and human modes without interpreting legacy notes", async () => {
	await missing.tracker.beads.update(
		trackerScope(missing.tracker.repository, "worker"),
		[missing.taskId],
		{ notes: "An old final answer" },
	);
	const json = await missing.invoke(["result", missing.requestId, "--json"]);
	expect(json.code).toBe(ONE);
	expect(JSON.parse(json.stdout)).toMatchObject({
		ok: false,
		reason: "response_missing",
		taskId: missing.taskId,
		requestId: missing.requestId,
		responseIds: [],
	});
	expect(json.stderr).toBe("");
	const human = await missing.invoke(["result", missing.requestId]);
	expect(human.stdout).toBe("");
	expect(human.stderr).toContain("Response missing");
});

test.each([
	{ args: ["--standalone", "--request", "request"] },
	{ args: ["--request", "foreign-request"] },
])("publication rejects incompatible request context $args without mutation", async ({ args }) => {
	const result = await missing.invoke([
		"response",
		"publish",
		missing.taskId,
		"--body-file",
		"answer.md",
		"--actor",
		"worker",
		...args,
		"--json",
	]);
	expect(result.code).toBe(ONE);
	expect(JSON.parse(result.stdout).ok).toBe(false);
	const records = await missing.tracker.beads.list(
		trackerScope(missing.tracker.repository, "worker"),
		{ all: true, labels: ["response"] },
	);
	expect(records.issues).toEqual([]);
});

test("standalone publication opts out of managed context and preserves human reservations", async () => {
	const reserved = await createTask(missing.tracker, { assignee: "ct" });
	const result = await missing.invoke([
		"response",
		"publish",
		reserved,
		"--standalone",
		"--body-file",
		"answer.md",
		"--actor",
		"worker",
		"--json",
	]);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		reason: "response_reserved",
		taskId: reserved,
	});
	const free = await createTask(missing.tracker);
	const published = await missing.invoke([
		"response",
		"publish",
		free,
		"--standalone",
		"--body-file",
		"answer.md",
		"--actor",
		"worker",
		"--json",
	]);
	expect(JSON.parse(published.stdout)).toMatchObject({ ok: true, taskId: free, effect: "created" });
	expect(JSON.parse(published.stdout)).not.toHaveProperty("requestId");
	const target = await missing.tracker.beads.show(
		trackerScope(missing.tracker.repository, "worker"),
		reserved,
	);
	expect(target.assignee).toBe("ct");
	expect(target.status).toBe("open");
});

test.each([{ mode: "json" }, { mode: "human" }])(
	"uncertain publication in $mode exposes the committed artifact and retry recovers its identity",
	async ({ mode }) => {
		let producer = interrupted;
		if (mode === "human") {
			producer = humanInterrupted;
		}
		let createdId = "";
		const broken = {
			...producer.tracker.beads,
			create: async (...args: Parameters<BeadsService["create"]>) => {
				const record = await producer.tracker.beads.create(...args);
				createdId = record.id;
				return record;
			},
			listProjected: unused,
		};
		const args = [
			"response",
			"publish",
			producer.taskId,
			"--body-file",
			"answer.md",
			"--actor",
			"worker",
		];
		let failureArgs = args;
		if (mode === "json") {
			failureArgs = [...args, "--json"];
		}
		const failed = await producer.invoke(failureArgs, broken);
		expect(failed.code).toBe(ONE);
		if (mode === "human") {
			expect(failed.stdout).toBe("");
			expect(failed.stderr).toContain(createdId);
			expect(failed.stderr).toContain("readback");
		} else {
			expect(JSON.parse(failed.stdout)).toMatchObject({
				ok: false,
				reason: "response_publish_uncertain",
				responseIds: [createdId],
				confirmedEffects: [{ operation: "create", responseId: createdId }],
				uncertainOperation: "readback",
			});
		}
		const repeat = await producer.invoke([...args, "--json"]);
		expect(JSON.parse(repeat.stdout)).toMatchObject({ responseId: createdId, effect: "existing" });
	},
);

test("source-specific discovery remains bounded and history preserves original provenance", async () => {
	const scope = trackerScope(history.tracker.repository, "author-one");
	await history.tracker.beads.comments.add(scope, history.taskId, "needle original commentary");
	await history.tracker.beads.comments.add(scope, history.taskId, "needle original commentary");
	await history.tracker.beads.update(scope, [history.taskId], {
		notes: '{"choice":"next","data":{"evidence":"needle"}}',
	});
	const other = await createTask(history.tracker, { title: "needle title only" });
	await history.tracker.beads.close(scope, other);
	await history.tracker.beads.update(scope, [other], { notes: "needle old notes" });
	const candidate = await history.invoke([
		"response",
		"search",
		"needle",
		"--source",
		"comments",
		"--limit",
		"1",
		"--json",
	]);
	expect(JSON.parse(candidate.stdout)).toMatchObject({
		source: "comments",
		hasMore: true,
		nextOffset: ONE,
		items: [{ source: "comment-candidate" }],
	});
	expect(candidate.stdout).not.toContain("original commentary");
	const notes = await history.invoke([
		"response",
		"search",
		"needle",
		"--source",
		"notes",
		"--limit",
		"1",
		"--json",
	]);
	expect(JSON.parse(notes.stdout)).toMatchObject({
		source: "notes",
		hasMore: true,
		items: [{ source: "notes-candidate" }],
	});
	const page = await history.invoke([
		"response",
		"history",
		history.taskId,
		"--limit",
		"1",
		"--json",
	]);
	const comments = JSON.parse(page.stdout);
	expect(comments).toMatchObject({
		nativeRead: "all-task-comments",
		coverage: { totalReturnedByNative: TWO, returned: ONE, offset: ZERO, hasMore: true },
		items: [
			{
				source: "comment",
				taskId: history.taskId,
				author: "author-one",
				text: "needle original commentary",
			},
		],
	});
	const next = await history.invoke([
		"response",
		"history",
		history.taskId,
		"--offset",
		"1",
		"--limit",
		"1",
		"--json",
	]);
	expect(JSON.parse(next.stdout).items[ZERO].localCommentId).not.toBe(
		comments.items[ZERO].localCommentId,
	);
	expect(JSON.parse(next.stdout).hasMore).toBe(false);
	const snapshot = await history.invoke([
		"response",
		"history",
		history.taskId,
		"--source",
		"notes",
		"--json",
	]);
	expect(JSON.parse(snapshot.stdout)).toMatchObject({
		source: "notes",
		author: null,
		authoredAt: null,
		text: '{"choice":"next","data":{"evidence":"needle"}}',
	});
	const invalid = await history.invoke([
		"response",
		"history",
		history.taskId,
		"--source",
		"notes",
		"--offset",
		"1",
		"--json",
	]);
	expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, reason: "invalid_response_input" });
});

test("filed search excludes bodies while exact corrections and status preserve identity", async () => {
	const producer = await createTask(history.tracker);
	const scope = trackerScope(history.tracker.repository, "worker");
	const first = await publishResponse(
		{ beads: history.tracker.beads, scope },
		{ taskId: producer, body: "needle original body" },
	);
	const args = [
		"response",
		"publish",
		producer,
		"--standalone",
		"--body-file",
		"answer.md",
		"--supersedes",
		first.responseId,
		"--actor",
		"worker",
		"--json",
	];
	const correction = await history.invoke(args);
	expect(correction.code).toBe(ZERO);
	const original = await history.invoke(["response", "get", first.responseId, "--json"]);
	expect(JSON.parse(original.stdout).response.body).toBe("needle original body");
	const found = await history.invoke(["response", "search", "needle", "--limit", "1", "--json"]);
	expect(JSON.parse(found.stdout).items).toEqual([
		{
			source: "response",
			responseId: first.responseId,
			title: `Response to ${producer}`,
			createdAt: expect.any(String),
		},
	]);
	expect(found.stdout).not.toContain("original body");
	const status = await lineage.invoke(["status", lineage.requestId, "--json"]);
	expect(JSON.parse(status.stdout).response).toEqual({
		state: "available",
		responseIds: [old.responseId],
	});
	expect(status.stdout).not.toContain("Old driver result");
});

test("schema discovery requires no tracker and public argument errors use one silent-stderr document", async () => {
	const schema = await missing.invoke(["response", "--schema"], {
		...missing.tracker.beads,
		list: unused,
	});
	expect(schema.code).toBe(ZERO);
	expect(JSON.parse(schema.stdout)).toMatchObject({
		ok: true,
		kind: "response_schema",
		schema: { anyOf: expect.any(Array) },
	});
	const invalid = await missing.invoke(["response", "get", "record", "--task", "task", "--json"]);
	expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, reason: "invalid_response_input" });
	const missingOption = await missing.invoke(["response", "publish", missing.taskId, "--json"]);
	expect(missingOption.code).toBe(TWO);
	expect(missingOption.stderr).toBe("");
});

// --- Private functions ---
async function fixture() {
	const tracker = memoryTracker();
	const taskId = await createTask(tracker, { assignee: "worker" });
	const requestId = await createSpawn(tracker, taskId);
	const invoke = async (args: string[], beads = tracker.beads) => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const deps = { ...tracker, beads };
		const handlers: BeeDependencies = {
			setup: unused,
			ack: unused,
			assess: unused,
			attachWorkflow: unused,
			dispatchStage: unused,
			finish: unused,
			kinds: unused,
			report: unused,
			retry: unused,
			run: unused,
			spawn: unused,
			stop: unused,
			status: (id, options) => inspectRequest(id, options, deps),
			responsePublish: (id, options) =>
				publishTaskResponse(id, options, {
					...deps,
					managedRequestId: requestId,
					readBody: () => Promise.resolve(BODY),
				}),
			responseGet: (id, options) => readTaskResponse(id, options, deps),
			responseSearch: (query, options) => findResponses(query, options, deps),
			responseHistory: (id, options) => readResponseHistory(id, options, deps),
			result: (id, options) => readRequestResult(id, options, deps),
			stdout: (text) => stdout.push(text),
			stderr: (text) => stderr.push(text),
		};
		let argv = [...args, "--beads-db", endpointOptions.beadsDb];
		if (args.includes("--schema")) {
			argv = args;
		}
		const code = await runBeeCli(argv, handlers);
		expect(stdout.length).toBeLessThanOrEqual(ONE);
		if (args.includes("--json") || args.includes("--schema")) {
			expect(stderr).toEqual([]);
		}
		return { code, stdout: stdout.join(""), stderr: stderr.join("") };
	};
	return { tracker, taskId, requestId, invoke };
}
function unused(): Promise<never> {
	return Promise.reject(new Error("Unexpected I/O path"));
}
