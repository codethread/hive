/* eslint-disable unicorn/no-null -- Assertions distinguish missing evidence from zero usage. */
import { expect, test } from "bun:test";
import { codexTokenEvidence } from "./postrun-evidence.ts";

const events = [
	{ type: "thread.started", thread_id: "first" },
	{
		type: "turn.completed",
		usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 },
	},
	{
		type: "turn.completed",
		usage: { input_tokens: 200, cached_input_tokens: 90, output_tokens: 20 },
	},
	{ type: "thread.started", thread_id: "second" },
	{
		type: "turn.completed",
		usage: { input_tokens: 30, cached_input_tokens: 10, output_tokens: 5 },
	},
].map((event) => JSON.stringify(event));
const nativeEvents = [
	{ type: "session_meta", payload: { id: "native" } },
	{
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 },
				last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 },
			},
		},
	},
	...Array.from({ length: 2 }, () => ({
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: { input_tokens: 250, cached_input_tokens: 90, output_tokens: 20 },
				last_token_usage: { input_tokens: 150, cached_input_tokens: 50, output_tokens: 10 },
			},
		},
	})),
].map((event) => JSON.stringify(event));
// Warm native boundary parsers outside the measured pure tests.
codexTokenEvidence(events);
codexTokenEvidence(nativeEvents);

test("native cumulative totals retain latest per thread and cached input remains a subset", () => {
	expect(codexTokenEvidence(events)).toMatchObject({
		measured: { cachedInput: 100, input: 230, output: 25 },
		orientation: "unavailable",
	});
});
test("native per-call counters retain first input and deduplicate repeated cumulative events", () => {
	expect(codexTokenEvidence(nativeEvents)).toMatchObject({
		measured: { input: 250, cachedInput: 90, output: 20 },
		threads: [{ id: "native", firstInput: 100 }],
		orientation: "unavailable",
	});
});
test("missing or malformed native counters do not manufacture zero usage", () => {
	expect(codexTokenEvidence(["plain log", '{"type":"turn.completed"}']).measured).toBeNull();
});
