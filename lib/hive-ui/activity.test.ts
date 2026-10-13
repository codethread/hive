import { beeActivity, outputAge } from "./src/activity.ts";
import { expect, test } from "bun:test";
import type { Bee } from "./contracts.ts";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const stdout = {
	attemptId: "attempt-2",
	attemptNumber: 2,
	lastOutputAt: "2026-10-13T11:59:59.000Z",
	recordedAt: "2026-10-13T12:00:00.000Z",
};

test.each([
	["2026-10-13T11:59:59.000Z", "active"],
	["2026-10-13T11:58:00.001Z", "active"],
	["2026-10-13T11:58:00.000Z", "quiet"],
	["2026-10-13T11:50:00.001Z", "quiet"],
	["2026-10-13T11:50:00.000Z", "attention"],
	["2026-10-13T11:00:00.000Z", "attention"],
	["2026-10-13T12:00:01.000Z", "quiet"],
	[null, "unknown"],
])("output at %s yields %s independently of publication time", (lastOutputAt, expected) => {
	expect(beeActivity({ outcome: "pending", stdout: { ...stdout, lastOutputAt } }, NOW)).toBe(
		expected,
	);
});

test("missing output evidence does not make a pending request active", () => {
	expect(beeActivity({ outcome: "pending", stdout: null }, NOW)).toBe("unknown");
});

test.each<Bee["outcome"]>(["succeeded", "failed", "cancelled"])(
	"recent output cannot reactivate a %s request",
	(outcome) => {
		expect(beeActivity({ outcome, stdout }, NOW)).toBe("ended");
	},
);

test.each([
	["2026-10-13T11:59:32.000Z", "28s ago"],
	["2026-10-13T11:58:00.000Z", "2m ago"],
	["2026-10-13T10:00:00.000Z", "2h ago"],
])("shows the source output age for %s", (at, expected) => {
	expect(outputAge(at, NOW)).toBe(expected);
});
