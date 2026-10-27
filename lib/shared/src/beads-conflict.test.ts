import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import { isBeadsConflict } from "./beads-conflict.ts";

const mergeMessage = "Configuration error: Merge conflicts detected:\n  - hv-a: BothModified\n";

test.each([
	{ kind: "merge", code: "CONFIG_ERROR", message: mergeMessage, wrapped: false, conflict: true },
	{
		kind: "wrapped merge",
		code: "CONFIG_ERROR",
		message: mergeMessage,
		wrapped: true,
		conflict: true,
	},
	{
		kind: "unrelated configuration",
		code: "CONFIG_ERROR",
		message: "Configuration error: missing database",
		wrapped: false,
		conflict: false,
	},
	{
		kind: "same text with another code",
		code: "IO_ERROR",
		message: mergeMessage,
		wrapped: false,
		conflict: false,
	},
])("native merge code/prefix: $kind #test-699", ({ code, message, wrapped, conflict }) => {
	let error: Error = new CommandError("br sync --merge", {
		code: 6,
		stderr: "",
		stdout: JSON.stringify({ error: { code, message } }),
	});
	if (wrapped) {
		error = new Error("publication failed", { cause: error });
	}
	expect(isBeadsConflict(error)).toBe(conflict);
});

test("conflict-like text without a native diagnostic is not a conflict", () => {
	expect(isBeadsConflict(new Error(mergeMessage))).toBe(false);
});
