import { HttpResponse, http } from "msw";
import type { LogEntry, LogQuery, LogResponse } from "../../log-contracts.ts";
import { logQuerySchema } from "../../log-contracts.ts";

const TIMESTAMP_INTERVAL = 2;
const LAST_ENTRY = -1;
const DETAIL_REPEATS = 20;
const PREVIEW_SIZE = 5;
const PAGE_SIZE = 50;
const DETAIL_CHUNK = 128;
const ENTRY_COUNT = 57;
export const logAttempts = [
	{
		id: "attempt-previous",
		number: 1,
		createdAt: "2026-10-14T18:00:00Z",
		state: "exited",
		harness: "pi",
	},
	{
		id: "attempt-current",
		number: 2,
		createdAt: "2026-10-14T19:00:00Z",
		state: "running",
		harness: "codex",
	},
];
/** Exercise the production HTTP contract with distinct attempts, streams and bounded reads. */
export const logHandler = http.get("/api/colonies/:colony/logs/:request", ({ request, params }) => {
	const query = logQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
	const id = String(params["request"]);
	if (id === "fixture-unavailable") {
		return HttpResponse.json(
			{ message: "Existing Colony inspection is unavailable." },
			{ status: 503 },
		);
	}
	return HttpResponse.json(logFixture(id, query));
});

// eslint-disable-next-line max-statements -- One fixture mirrors each production response variant.
export function logFixture(request: string, query: LogQuery): LogResponse {
	const attempt = logAttempts.find((entry) => entry.id === (query.attempt ?? "attempt-current"))!;
	const selection = { attempts: logAttempts, attempt };
	if (request === "fixture-missing") {
		return { ...selection, kind: "missing", message: "The retained stdout file is missing." };
	}
	if (request === "fixture-no-launch") {
		return {
			attempts: [],
			attempt: null,
			kind: "missing",
			message: "No retained launch exists for this request.",
		};
	}
	const lines = fixtureLines(attempt.id, query.stream);
	const entries: LogEntry[] = [];
	let offset = 0;
	for (const [index, line] of lines.entries()) {
		entries.push({
			offset,
			end: offset + line.length,
			kind: index === 1 ? "malformed JSON / text" : query.stream,
			content:
				index === 1
					? line
					: `${attempt.harness} ${query.stream} entry ${index + 1}: retained evidence`,
			timestamp: index % TIMESTAMP_INTERVAL === 0 ? "2026-10-14T19:01:00Z" : null,
		});
		offset += line.length + 1;
	}
	if (query.mode === "raw") {
		const source = lines.join("\n");
		const end = Math.min(query.end!, query.cursor + DETAIL_CHUNK);
		return {
			...selection,
			kind: "raw",
			text: source.slice(query.cursor, end),
			next: end < query.end! ? end : null,
		};
	}
	const candidates =
		request === "fixture-empty" ? [] : entries.filter((entry) => entry.offset >= query.cursor);
	const page =
		query.mode === "preview" ? candidates.slice(-PREVIEW_SIZE) : candidates.slice(0, PAGE_SIZE);
	return {
		...selection,
		kind: "page",
		entries: page,
		next:
			query.mode === "page" && candidates.length > PAGE_SIZE ? page.at(LAST_ENTRY)!.end + 1 : null,
		incompleteTail: request === "fixture-incomplete",
	};
}

function fixtureLines(attempt: string, stream: LogQuery["stream"]): string[] {
	if (stream === "stderr") {
		return [
			"stderr diagnostic: warning on the selected attempt",
			"stderr diagnostic: plain text retained",
		];
	}
	const previous = attempt === "attempt-previous";
	return Array.from({ length: previous ? PREVIEW_SIZE : ENTRY_COUNT }, (_line, index) =>
		index === 1
			? "{malformed native JSON; keep this line visible"
			: JSON.stringify({
					type: previous ? "message_update" : "event_msg",
					payload: {
						message: `${previous ? "Pi previous" : "Codex current"} entry ${index + 1}`,
						details: "Retained details. ".repeat(DETAIL_REPEATS),
						inert: "<script>alert('evidence')</script>",
					},
				}),
	);
}
