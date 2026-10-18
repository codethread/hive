import { expect, test } from "bun:test";
import { parseProcess } from "./processes.ts";

const START = "Sun Oct 18 20:00:00 2026";

test("single-PID ownership preserves lifetime and group across argv changes", () => {
	const result = parseProcess(` 123 1 123 ${START} renamed worker --argument with spaces\n`);
	expect(result).toEqual({
		group: 123,
		process: {
			cmd: "renamed worker --argument with spaces",
			pid: 123,
			ppid: 1,
			startTime: Date.parse(START),
		},
	});
});

test.each([
	{ name: "missing", output: "" },
	{ name: "missing start time", output: "123 1 123 worker" },
	{ name: "invalid start time", output: "123 1 123 Sun Bad 18 20:00:00 2026 worker" },
	{ name: "multiple processes", output: `123 1 123 ${START} worker\n456 1 456 ${START} unrelated` },
])("$name process evidence is refused", ({ output }) => {
	expect(() => parseProcess(output)).toThrow(Error);
});
