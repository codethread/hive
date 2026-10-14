import type { AttemptDetails, ColonyInspection } from "@hive/shared";
import { afterAll, expect, test } from "bun:test";
import { createLogData, readRetainedLog } from "./logs.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Real-file tests own isolated retained evidence.
import { mkdtemp, rm } from "node:fs/promises";
import { CommandError } from "@hive/beads";
import { createColonyInspector } from "./log-inspection.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary artifact paths mirror inspection paths.
import { join } from "node:path";
import { logQuerySchema } from "../log-contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Host temporary directory keeps test evidence isolated.
import { tmpdir } from "node:os";

const MANY_EVENTS = 123;
const NATIVE_TIME_MS = 1_700_000_000_000;
const LARGE_CHARACTERS = 40_000;
const CURRENT_ATTEMPT = 2;
const FOREIGN_ATTEMPT = 3;
const PAGE_ENTRIES = 50;
const CONTENT_CHARS = 600;
const CHUNK_BYTES = 65_536;
const PLAIN_ENTRY = 4;

const directory = await mkdtemp(join(tmpdir(), "hive-ui-logs-"));
const repository = { root: "/fixture/repository", beadsDb: "/fixture/tracker/.beads/beads.db" };
const lines = Array.from({ length: MANY_EVENTS }, (_entry, index) =>
	JSON.stringify({
		type: "item.completed",
		item: { text: `event ${index}` },
	}),
);
const stdout = join(directory, "stdout.log");
const older = join(directory, "older.log");
const large = join(directory, "large.log");
const foreign = join(directory, "foreign.log");
await Bun.write(stdout, `${lines.join("\n")}\n{"partial":`);
await Bun.write(
	older,
	'{"type":"message_end","message":{"content":[{"text":"earlier retry"}],"timestamp":1700000000000}}\n',
);
const hugeText = `${"🐝".repeat(LARGE_CHARACTERS)}<script>alert('inert')</script>`;
const largeEvent = {
	type: "message_end",
	message: { content: [{ text: hugeText }], timestamp: NATIVE_TIME_MS },
};
await Bun.write(large, `${JSON.stringify(largeEvent)}\nlast\n`);
await Bun.write(foreign, "do not read another request\n");
await Bun.write(join(directory, "stderr.log"), "stderr diagnostics\n");
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

const evidence: ColonyInspection = {
	kind: "inspection",
	colony: null,
	history: [],
	repository,
	observedAt: "2026-10-14T19:00:00Z",
	attempts: [
		attempt("old", 1, older),
		attempt("current", CURRENT_ATTEMPT, stdout),
		{ ...attempt("foreign", FOREIGN_ATTEMPT, foreign), spawnId: "hv-other" },
	],
	requests: [
		{
			id: "hv-request",
			attemptId: "current",
			attempts: CURRENT_ATTEMPT,
			identity: "fixture",
			message: "",
			outcome: null,
			retryAt: null,
			state: "executing",
			taskIds: [],
		},
	],
};
const read = createLogData({ inspect: () => Promise.resolve(evidence), read: readRetainedLog });

// eslint-disable-next-line max-statements -- Verify the selected preview projection and partial-tail contract together.
test("preview returns last five complete entries in source order and withholds partial tail", async () => {
	const result = await read(repository, "hv-request", logQuerySchema.parse({}));
	expect(result.kind).toBe("page");
	if (result.kind !== "page") {
		throw new Error("Expected page");
	}
	expect(result.entries.map((entry) => entry.content)).toEqual([
		"event 118",
		"event 119",
		"event 120",
		"event 121",
		"event 122",
	]);
	expect(result.entries.every((entry) => entry.timestamp === null)).toBe(true);
	expect(result.incompleteTail).toBe(true);
	expect(result.next).toBeNull();
	expect(result.attempt?.id).toBe("current");
	expect(result.attempts.map(({ id }) => id)).toEqual(["old", "current"]);
	expect(JSON.stringify(result)).not.toContain(directory);
});

// eslint-disable-next-line max-statements -- Follow cursors through retained history before switching attempts.
test("chronological byte paging reaches every complete entry without mixing retries", async () => {
	const collected: string[] = [];
	let cursor: number | null = 0;
	while (cursor !== null) {
		// eslint-disable-next-line no-await-in-loop -- Each server cursor selects the next source page.
		const result = await read(
			repository,
			"hv-request",
			logQuerySchema.parse({ mode: "page", attempt: "current", cursor }),
		);
		if (result.kind !== "page") {
			throw new Error("Expected page");
		}
		expect(result.entries.length).toBeLessThanOrEqual(PAGE_ENTRIES);
		collected.push(...result.entries.map((entry) => entry.content));
		cursor = result.next;
	}
	expect(collected).toEqual(lines.map((_entry, index) => `event ${index}`));
	const retained = await read(repository, "hv-request", logQuerySchema.parse({ attempt: "old" }));
	if (retained.kind !== "page") {
		throw new Error("Expected page");
	}
	expect(retained.entries[0]?.content).toBe("earlier retry");
	expect(retained.entries[0]?.timestamp).toBe("2023-11-14T22:13:20.000Z");
});

test("foreign attempt and mismatched repository evidence fail before any file read", async () => {
	let reads = 0;
	const selected = createLogData({
		inspect: () => Promise.resolve(evidence),
		read: () => {
			reads += 1;
			return Promise.resolve({ kind: "missing", message: "unused" });
		},
	});
	await expectFailure(
		selected(repository, "hv-request", logQuerySchema.parse({ attempt: "foreign" })),
	);
	await expectFailure(
		selected({ ...repository, beadsDb: "/other/db" }, "hv-request", logQuerySchema.parse({})),
	);
	expect(reads).toBe(0);
});

// eslint-disable-next-line max-statements -- Reconstruct one large entry from the public bounded-detail contract.
test("large entry summaries stay bounded and raw detail chunks reconstruct complete UTF-8 evidence", async () => {
	const result = await readRetainedLog(large, logQuerySchema.parse({ mode: "page" }));
	if (result.kind !== "page") {
		throw new Error("Expected page");
	}
	const entry = result.entries[0]!;
	expect(entry.kind).toBe("message_end");
	expect(entry.timestamp).toBe("2023-11-14T22:13:20.000Z");
	expect(entry.content.length).toBeLessThanOrEqual(CONTENT_CHARS);
	let cursor: number | null = entry.offset;
	let raw = "";
	while (cursor !== null) {
		// eslint-disable-next-line no-await-in-loop -- Chunks follow byte cursors without loading one unbounded response.
		const chunk = await readRetainedLog(
			large,
			logQuerySchema.parse({ mode: "raw", cursor, end: entry.end }),
		);
		if (chunk.kind !== "raw") {
			throw new Error("Expected raw chunk");
		}
		expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(CHUNK_BYTES);
		raw += chunk.text;
		cursor = chunk.next;
	}
	expect(raw).toBe(JSON.stringify(largeEvent));
	expect(result.entries[1]?.content).toBe("last");
});

test("native formats and unfamiliar/malformed/text evidence stay visible with native times only", async () => {
	const path = join(directory, "formats.log");
	await Bun.write(
		path,
		`${[
			JSON.stringify({
				type: "item.completed",
				timestamp: "2026-10-14T19:00:00Z",
				item: { text: "Codex" },
			}),
			JSON.stringify({ type: "message_update", assistantMessageEvent: { delta: "Pi delta" } }),
			JSON.stringify({ unknown: "evidence" }),
			"{broken",
			"plain <img onerror=alert(1)>",
			"",
		].join("\n")}\n`,
	);
	const result = await readRetainedLog(path, logQuerySchema.parse({ mode: "page" }));
	if (result.kind !== "page") {
		throw new Error("Expected page");
	}
	expect(result.entries.map(({ kind }) => kind)).toEqual([
		"item.completed",
		"message_update",
		"Unfamiliar JSON",
		"Malformed JSON / text",
		"Text",
		"Text",
	]);
	expect(result.entries[0]?.timestamp).toBe("2026-10-14T19:00:00Z");
	expect(result.entries[1]?.content).toBe("Pi delta");
	expect(result.entries.slice(1).every(({ timestamp }) => timestamp === null)).toBe(true);
	expect(result.entries[PLAIN_ENTRY]?.content).toBe("plain <img onerror=alert(1)>");
});

// eslint-disable-next-line max-statements -- Keep empty, missing and unavailable boundary outcomes distinct.
test("empty, missing, no-launch and unavailable inspection remain distinct", async () => {
	const empty = join(directory, "empty.log");
	await Bun.write(empty, "");
	expect(await readRetainedLog(empty, logQuerySchema.parse({}))).toEqual({
		kind: "page",
		entries: [],
		next: null,
		incompleteTail: false,
	});
	const missing = await readRetainedLog(join(directory, "missing.log"), logQuerySchema.parse({}));
	expect(missing.kind).toBe("missing");
	const noLaunch = await read(repository, "hv-never-launched", logQuerySchema.parse({}));
	expect(noLaunch.kind).toBe("missing");
	expect(noLaunch.attempt).toBeNull();
	const unavailable = createLogData({
		inspect: () => Promise.reject(new Error("daemon unavailable")),
		read: readRetainedLog,
	});
	await expectFailure(unavailable(repository, "hv-request", logQuerySchema.parse({})));
	await expectFailure(readRetainedLog(directory, logQuerySchema.parse({})));
});

test("stderr stays separate and latest retained attempt is selected without a checkpoint", async () => {
	const selected = createLogData({
		inspect: () => Promise.resolve({ ...evidence, requests: [] }),
		read: readRetainedLog,
	});
	const result = await selected(
		repository,
		"hv-request",
		logQuerySchema.parse({ stream: "stderr" }),
	);
	if (result.kind !== "page") {
		throw new Error("Expected page");
	}
	expect(result.attempt?.id).toBe("current");
	expect(result.entries.map(({ content }) => content)).toEqual(["stderr diagnostics"]);
});

test("inspection calls only inspect with explicit endpoint/server selection and validates output", async () => {
	const calls: string[][] = [];
	const inspect = createColonyInspector(
		{
			execute: (argv) => {
				calls.push(argv);
				return Promise.resolve(JSON.stringify({ ok: true, ...evidence }));
			},
			log: async () => {},
		},
		{ state: "/chosen/state", socket: "/chosen/socket" },
	);
	expect(await inspect(repository)).toEqual(evidence);
	expect(calls).toEqual([
		[
			"colony",
			"inspect",
			"--repo",
			repository.root,
			"--beads-db",
			repository.beadsDb,
			"--json",
			"--state",
			"/chosen/state",
			"--socket",
			"/chosen/socket",
		],
	]);
	const invalid = createColonyInspector(
		{
			execute: () => Promise.resolve(JSON.stringify({ ok: true, kind: "awake", repository })),
			log: async () => {},
		},
		{},
	);
	await expectFailure(invalid(repository));
});

test("inspection preserves the native JSON failure diagnostic returned on stdout", async () => {
	const failure = new CommandError("colony", {
		code: 1,
		stderr: "",
		stdout: JSON.stringify({
			ok: false,
			kind: "error",
			reason: "operation_failed",
			message: "Cannot reach selected daemon",
		}),
	});
	const inspect = createColonyInspector(
		{ execute: () => Promise.reject(failure), log: () => Promise.resolve() },
		{},
	);
	const outcome = await inspect(repository).catch((error: unknown) => error);
	expect(outcome).toBeInstanceOf(Error);
	if (!(outcome instanceof Error)) {
		throw new Error("Expected unavailable inspection");
	}
	expect(outcome.message).toMatchInlineSnapshot(
		`"Existing Colony inspection is unavailable: Cannot reach selected daemon"`,
	);
});

function attempt(id: string, attemptNumber: number, path: string): AttemptDetails {
	return {
		id,
		attemptNumber,
		spawnId: "hv-request",
		state: "exited",
		bucket: repository.root,
		createdAt: "2026-10-14T19:00:00Z",
		cwd: repository.root,
		harness: "codex",
		identity: "fixture",
		kind: "worker",
		model: "fixture",
		policyRevisionId: null,
		taskIds: [],
		paths: {
			stdout: path,
			stderr: join(directory, "stderr.log"),
			receipt: join(directory, "receipt.json"),
			supervisor: join(directory, "supervisor.log"),
			worker: join(directory, "worker.json"),
		},
	};
}

async function expectFailure(work: Promise<unknown>): Promise<void> {
	const outcome = await work.catch((error: unknown) => error);
	expect(outcome).toBeInstanceOf(Error);
}
