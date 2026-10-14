import type { ColonyInspection, RepositoryEndpoint } from "@hive/shared";
import type { LogEntry, LogQuery, LogResponse } from "../log-contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Positioned file handle is the live read adapter.
import type { FileHandle } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Retained logs are read through bounded positioned file reads.
import { open } from "node:fs/promises";
import { z } from "zod";

const BLOCK_BYTES = 65_536;
const SUMMARY_CHARS = 600;
const PAGE_ENTRIES = 50;
const PREVIEW_ENTRIES = 5;
const LAST = -1;
const LF = 10;
const UTF8_CONTINUATION = 192;
const UTF8_MARKER = 0x80;

interface LogDependencies {
	/** Existing public read-only inspection, composed at startup. */
	inspect: (repository: RepositoryEndpoint) => Promise<ColonyInspection>;
	/** File adapter receives only paths from validated inspection evidence. */
	read: (path: string, query: LogQuery) => Promise<LogContents>;
}
type LogContents =
	| { kind: "missing"; message: string }
	| { kind: "page"; entries: LogEntry[]; next: number | null; incompleteTail: boolean }
	| { kind: "raw"; text: string; next: number | null };

/** Bind every read to the configured endpoint and one retained request/attempt. */
// eslint-disable-next-line max-statements -- One binding action selects request-local evidence before file I/O.
export function createLogData({ inspect, read }: LogDependencies) {
	// eslint-disable-next-line max-statements -- Selection and endpoint validation are one read boundary.
	return async (
		repository: RepositoryEndpoint,
		request: string,
		query: LogQuery,
	): Promise<LogResponse> => {
		const evidence = await inspect(repository);
		if (
			evidence.repository.root !== repository.root ||
			evidence.repository.beadsDb !== repository.beadsDb
		) {
			throw new Error("Inspection returned a different repository or tracker.");
		}
		const retained = evidence.attempts
			.filter((attempt) => attempt.spawnId === request)
			.toSorted(
				(left, right) =>
					left.attemptNumber - right.attemptNumber || left.createdAt.localeCompare(right.createdAt),
			);
		const current = evidence.requests.find((entry) => entry.id === request)?.attemptId;
		const selected = query.attempt ?? current ?? retained.at(LAST)?.id;
		const attempt = retained.find((entry) => entry.id === selected);
		if (query.attempt !== undefined && !attempt) {
			throw new Error("The selected attempt does not belong to this request.");
		}
		const attempts = retained.map(({ id, attemptNumber, createdAt, state, harness }) => ({
			id,
			number: attemptNumber,
			createdAt,
			state,
			harness,
		}));
		const selection = {
			attempts,
			attempt: attempts.find((entry) => entry.id === attempt?.id) ?? null,
		};
		if (!attempt) {
			return {
				...selection,
				kind: "missing",
				message: "No retained launch is available for this request.",
			};
		}
		return { ...selection, ...(await read(attempt.paths[query.stream], query)) };
	};
}

/** Live file adapter: bounded scans/responses; decode metadata one complete entry at a time. */
// eslint-disable-next-line max-statements -- Acquire and close one file around the selected bounded operation.
export async function readRetainedLog(path: string, query: LogQuery): Promise<LogContents> {
	let file: FileHandle | undefined = undefined;
	try {
		file = await open(path, "r");
	} catch (error) {
		if (isMissing(error)) {
			return { kind: "missing", message: `The retained ${query.stream} file is not available.` };
		}
		throw error;
	}
	try {
		const { size } = await file.stat();
		if (query.cursor > size) {
			throw new Error("Log cursor is beyond the retained file. Refresh the log.");
		}
		if (query.mode === "raw") {
			return await readRaw(file, size, query);
		}
		let start = query.cursor;
		let limit = PAGE_ENTRIES;
		if (query.mode === "preview") {
			start = await previewStart(file, size);
			limit = PREVIEW_ENTRIES + 1;
		}
		return await readPage(file, size, { start, limit });
	} finally {
		await file.close();
	}
}

// --- Bounded scanning and native evidence projection ---
// eslint-disable-next-line max-statements -- Reverse source offsets require a sequential bounded scan.
async function previewStart(file: FileHandle, size: number): Promise<number> {
	const buffer = Buffer.alloc(BLOCK_BYTES);
	let position = size;
	let endings = 0;
	while (position > 0) {
		const length = Math.min(position, BLOCK_BYTES);
		position -= length;
		// eslint-disable-next-line no-await-in-loop -- Each positioned block supplies the next earlier scan boundary.
		const { bytesRead } = await file.read(buffer, 0, length, position);
		for (let index = bytesRead - 1; index >= 0; index -= 1) {
			if (buffer[index] === LF) {
				endings += 1;
				if (endings > PREVIEW_ENTRIES) {
					return position + index + 1;
				}
			}
		}
	}
	return 0;
}

// Locate source lines in blocks; decode each complete native entry before bounding its summary.
// eslint-disable-next-line max-statements
async function readPage(
	file: FileHandle,
	size: number,
	{ start, limit }: { start: number; limit: number },
): Promise<LogContents> {
	const buffer = Buffer.alloc(BLOCK_BYTES);
	const entries: LogEntry[] = [];
	let position = start;
	let lineStart = start;
	while (position < size) {
		// eslint-disable-next-line no-await-in-loop -- Sequential source blocks locate complete line boundaries.
		const { bytesRead } = await file.read(
			buffer,
			0,
			Math.min(BLOCK_BYTES, size - position),
			position,
		);
		if (bytesRead === 0) {
			throw new Error("The retained log changed during the read. Refresh the log.");
		}
		for (let index = 0; index < bytesRead; index += 1) {
			if (buffer[index] !== LF) {
				// eslint-disable-next-line no-continue -- Process only newline boundaries in this byte scan.
				continue;
			}
			const end = position + index;
			// eslint-disable-next-line no-await-in-loop -- Decode entries in source order, reusing the scanned block.
			const text = await entryText(file, { offset: lineStart, end }, { buffer, position });
			entries.push(projectEntry(text, lineStart, end));
			lineStart = end + 1;
			if (entries.length === limit) {
				return {
					kind: "page",
					entries,
					next: nextOffset(lineStart, size),
					incompleteTail: false,
				};
			}
		}
		position += bytesRead;
	}
	return { kind: "page", entries, next: null, incompleteTail: lineStart < size };
}

/** Metadata decoding retains at most one complete native entry, never the whole session. */
async function entryText(
	file: FileHandle,
	{ offset, end }: { offset: number; end: number },
	{ buffer: block, position }: { buffer: Buffer; position: number },
): Promise<string> {
	if (offset >= position) {
		return block.subarray(offset - position, end - position).toString("utf8");
	}
	const buffer = Buffer.alloc(end - offset);
	let captured = 0;
	while (captured < buffer.length) {
		// eslint-disable-next-line no-await-in-loop -- Positioned reads fill this entry in bounded blocks.
		const { bytesRead } = await file.read(
			buffer,
			captured,
			Math.min(BLOCK_BYTES, buffer.length - captured),
			offset + captured,
		);
		if (bytesRead === 0) {
			throw new Error("The retained log changed during the read. Refresh the log.");
		}
		captured += bytesRead;
	}
	return buffer.toString("utf8");
}

// eslint-disable-next-line max-statements -- Validate the range and preserve UTF-8 chunk boundaries together.
async function readRaw(file: FileHandle, size: number, query: LogQuery): Promise<LogContents> {
	if (query.end === undefined || query.end < query.cursor || query.end > size) {
		throw new Error("Raw details require a valid end offset from the selected entry.");
	}
	const length = Math.min(BLOCK_BYTES, query.end - query.cursor);
	const buffer = Buffer.alloc(length + 1);
	const { bytesRead } = await file.read(
		buffer,
		0,
		Math.min(length + 1, size - query.cursor),
		query.cursor,
	);
	let count = Math.min(length, bytesRead);
	// Leave an incomplete UTF-8 character for the next chunk; preserve literal source text.
	if (query.cursor + count < query.end) {
		while (count > 0 && (buffer[count]! & UTF8_CONTINUATION) === UTF8_MARKER) {
			count -= 1;
		}
	}
	if (count === 0 && length > 0) {
		throw new Error("The retained log changed during the read. Refresh the log.");
	}
	const next = query.cursor + count;
	return {
		kind: "raw",
		text: buffer.subarray(0, count).toString("utf8"),
		next: nextOffset(next, query.end),
	};
}

// eslint-disable-next-line max-statements -- Unfamiliar native values retain their inert evidence.
function projectEntry(text: string, offset: number, end: number): LogEntry {
	let value: unknown = null;
	try {
		value = JSON.parse(text);
	} catch {
		let kind = "Text";
		if (text.trimStart().startsWith("{")) {
			kind = "Malformed JSON / text";
		}
		return {
			offset,
			end,
			kind,
			content: text.slice(0, SUMMARY_CHARS),
			timestamp: null,
		};
	}
	const record = object(value);
	const message = object(record["message"]);
	const kind = string(record["type"]) ?? string(record["event"]) ?? "Unfamiliar JSON";
	const content = readable(record) ?? JSON.stringify(value);
	return {
		offset,
		end,
		kind,
		content: content.slice(0, SUMMARY_CHARS),
		timestamp: nativeTime(record["timestamp"] ?? message["timestamp"]),
	};
}

function readable(record: Record<string, unknown>): string | undefined {
	const item = object(record["item"]);
	const message = object(record["message"]);
	const delta = object(record["assistantMessageEvent"]);
	const content = record["content"] ?? message["content"];
	if (Array.isArray(content)) {
		const text = content
			.map((part: unknown) => string(object(part)["text"]) ?? "")
			.filter(Boolean)
			.join("\n");
		if (text !== "") {
			return text;
		}
	}
	return (
		string(record["text"]) ??
		string(item["text"]) ??
		string(record["delta"]) ??
		string(delta["delta"]) ??
		string(content)
	);
}

function nativeTime(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date.toISOString();
		}
		return null;
	}
	if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
		return value;
	}
	return null;
}

function object(value: unknown): Record<string, unknown> {
	const parsed = z.record(z.string(), z.unknown()).safeParse(value);
	if (parsed.success) {
		return parsed.data;
	}
	return {};
}
function string(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	return undefined;
}
function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function nextOffset(position: number, end: number): number | null {
	if (position < end) {
		return position;
	}
	return null;
}
