import { expect, test } from "bun:test";
import { Command } from "commander";
import type { HarnessAlertDependencies } from "../../src/harness-alerts.ts";
import { addAlertHooks } from "../../src/harness-alerts.ts";
import { fixture } from "../support.ts";

const active = {
	ok: true,
	kind: "tracker_alert",
	database: "/selected/.beads/beads.db",
	alert: {
		id: "incident-one",
		generation: 1,
		state: "active",
		reason: "publication failed",
		raisedAt: "2026-10-18T05:00:00Z",
	},
} as const;
const input = JSON.stringify({
	session_id: "session-one",
	cwd: "/different/code/worktree",
	hook_event_name: "PostToolUse",
});
const receiptPath: HarnessAlertDependencies["receiptPath"] = () => "/user-state/session.json";

// eslint-disable-next-line max-statements -- Exercise both native protocol entry routes without application wrapping.
test("registration emits native hook JSON and accepts the Pi payload without reading stdin", async () => {
	const fx = fixture();
	const output: string[] = [];
	const deps: HarnessAlertDependencies = {
		...fx.deps,
		receiptPath,
		observe: () => Promise.resolve(active),
		stdin: () => Promise.resolve(input),
		stdout: (text) => output.push(text),
	};
	const program = new Command();
	addAlertHooks(program, deps);
	await program.parseAsync(["harness-alert", "--harness", "codex"], { from: "user" });
	expect(JSON.parse(output.join(""))).toMatchObject({
		hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: expect.any(String) },
	});
	output.length = 0;
	deps.stdin = () => {
		throw new Error("Pi must not read stdin");
	};
	await program.parseAsync(["harness-alert", "--harness", "pi", "--input", input], {
		from: "user",
	});
	expect(JSON.parse(output.join(""))).toMatchObject({ context: expect.any(String) });
});
