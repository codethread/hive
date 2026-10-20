import { expect, test } from "bun:test";
import type { HarnessAlertDependencies } from "../../src/harness-alerts.ts";
import { fixture } from "../support.ts";
import { runCli } from "../../src/cli.ts";

const SUCCESS = 0;
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
test("registration emits native hook JSON and accepts the Pi payload without reading stdin #test-378", async () => {
	const fx = fixture();
	const { output } = fx;
	fx.deps.alertReceiptPath = receiptPath;
	fx.deps.beads.alertStatus = () => Promise.resolve(active);
	fx.deps.stdin = () => Promise.resolve(input);
	expect(await runCli(["system", "harness-alert", "--harness", "codex"], fx.deps)).toBe(SUCCESS);

	expect(JSON.parse(output.join(""))).toMatchObject({
		hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: expect.any(String) },
	});
	output.length = 0;
	fx.deps.stdin = () => {
		throw new Error("Pi must not read stdin");
	};
	expect(
		await runCli(["system", "harness-alert", "--harness", "pi", "--input", input], fx.deps),
	).toBe(SUCCESS);
	expect(JSON.parse(output.join(""))).toMatchObject({ context: expect.any(String) });
});
