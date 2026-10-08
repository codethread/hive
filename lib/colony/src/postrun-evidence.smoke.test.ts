import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Reuse disposable filesystem fixtures for native telemetry lookup.
import { mkdtemp, rm } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Scope every native session path to the fixture.
import { join } from "node:path";
import { readTokenEvidence } from "./postrun-evidence.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated private evidence directory.
import { tmpdir } from "node:os";

const FIRST = 0;
const FIRST_INPUT = 100;
const LATER_INPUT = 200;
const THREAD = "01a11d65-f5f2-76d1-94ff-e3b13970101f";
const usage = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 };
const events = [
	{ type: "session_meta", payload: { id: THREAD, cli_version: "0.161.0" } },
	{
		type: "event_msg",
		payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } },
	},
]
	.map((event) => JSON.stringify(event))
	.join("\n");

// eslint-disable-next-line max-statements -- One real filesystem fixture proves exact-thread lookup, absence and ambiguity handling.
test("self-reaped Codex runs recover only their exact native counters", async () => {
	const root = await mkdtemp(join(tmpdir(), "postrun-usage-"));
	const stdout = join(root, "stdout.log");
	const native = join(root, "sessions", "2026", "10", "08", `rollout-${THREAD}.jsonl`);
	try {
		await Bun.write(stdout, JSON.stringify({ type: "thread.started", thread_id: THREAD }));
		const missing = await readTokenEvidence(stdout, "codex", root);
		expect(missing.measured).toBeNull();
		await Bun.write(native, events);
		await Bun.write(join(root, "sessions", "unrelated.jsonl"), "not our session");
		const recovered = await readTokenEvidence(stdout, "codex", root);
		expect(recovered.measured).toEqual({ input: 100, cachedInput: 40, output: 10 });
		expect(recovered.threads[FIRST]?.firstInput).toBe(FIRST_INPUT);
		expect(recovered.sources).toEqual([stdout, native]);
		// A later stdout snapshot is the fresher cumulative observation, not another amount to add.
		await Bun.write(
			stdout,
			[
				JSON.stringify({ type: "thread.started", thread_id: THREAD }),
				JSON.stringify({ type: "turn.completed", usage: { ...usage, input_tokens: 200 } }),
			].join("\n"),
		);
		const newer = await readTokenEvidence(stdout, "codex", root);
		expect(newer.measured?.input).toBe(LATER_INPUT);
		await Bun.write(join(root, "sessions", `rollout-copy-${THREAD}.jsonl`), events);
		const ambiguous = await readTokenEvidence(stdout, "codex", root);
		expect(ambiguous.threads[FIRST]?.firstInput).toBeNull();
		const unsupported = await readTokenEvidence(stdout, "other", root);
		expect(unsupported.measured).toBeNull();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
