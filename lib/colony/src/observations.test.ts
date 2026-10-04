/* eslint-disable unicorn/no-null -- Tests distinguish no output from observed stdout. */
import { expect, test } from "bun:test";
import { stdoutActivityDue } from "./observations.ts";

const previous = {
	attemptId: "attempt-one",
	attemptNumber: 1,
	lastOutputAt: "2026-10-04T10:00:00.123Z",
	recordedAt: "2026-10-04T10:00:01.000Z",
};

test.each([
	{ due: false, final: false, recordedAt: "2026-10-04T10:00:30.999Z" },
	{ due: true, final: false, recordedAt: "2026-10-04T10:00:31.000Z" },
	{ due: true, final: true, recordedAt: "2026-10-04T10:00:02.000Z" },
])("changed stdout publication at $recordedAt, final=$final", ({ due, final, recordedAt }) => {
	expect(
		stdoutActivityDue(
			previous,
			{ ...previous, lastOutputAt: "2026-10-04T10:00:01.500Z", recordedAt },
			final,
		),
	).toBe(due);
});

test("silence never refreshes an existing activity timestamp, including settlement", () => {
	const later = { ...previous, recordedAt: "2026-10-04T12:00:00.000Z" };
	expect(stdoutActivityDue(previous, later)).toBe(false);
	expect(stdoutActivityDue(previous, later, true)).toBe(false);
	expect(
		stdoutActivityDue({ ...previous, lastOutputAt: null }, { ...later, lastOutputAt: null }),
	).toBe(false);
});

test("new attempts replace old activity with unknown and first actual output publishes immediately", () => {
	const fresh = { ...previous, attemptId: "attempt-two", attemptNumber: 2, lastOutputAt: null };
	expect(stdoutActivityDue(undefined, fresh)).toBe(true);
	expect(stdoutActivityDue(previous, fresh)).toBe(true);
	expect(stdoutActivityDue(fresh, { ...fresh, lastOutputAt: previous.lastOutputAt })).toBe(true);
});
