import { expect, test } from "bun:test";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { claimedBead } from "../../../.pi/extensions/beads.ts";

function claimResult(command: string, output: string, isError = false): ToolResultEvent {
	return {
		content: [{ text: output, type: "text" }],
		details: undefined,
		input: { command },
		isError,
		toolCallId: "claim",
		toolName: "bash",
		type: "tool_result",
	};
}
const output = JSON.stringify([{ id: "hv-9d9", status: "in_progress", title: "Bead status" }]);

test.each([
	"br update hv-9d9 --claim --owner ct --json",
	"br --actor pi update hv-9d9 --claim --owner ct --json",
	"BD_ACTOR=pi br --db /repo/beads.db update hv-9d9 --owner ct --claim --json",
	"cd /repo && br update hv-9d9 --claim --json",
])("recognizes a successful claim: %s", (command) => {
	expect(claimedBead(claimResult(command, output))).toBe("hv-9d9");
});

test.each([
	{ command: "br show hv-9d9 --json", isError: false, output },
	{
		command: "br update hv-9d9 --notes 'mentions --claim here' --json",
		isError: false,
		output,
	},
	{
		command: 'br update hv-9d9 --notes "mentions \\" --claim here" --json',
		isError: false,
		output,
	},
	{ command: "br update hv-9d9 --owner ct --json", isError: false, output },
	{ command: "br update hv-9d9 --claim --json", isError: true, output },
	{ command: "br update hv-9d9 --claim --json", isError: false, output: "Claim failed" },
	{ command: "br update hv-9d9 --claim --json", isError: false, output: "[]" },
	{
		command: "br update hv-9d9 --claim --json",
		isError: false,
		output: '[{"id":"hv-9d9","status":"open"}]',
	},
])(
	"ignores unrelated or unsuccessful results: %# #test-594",
	({ command, output: result, isError }) => {
		expect(claimedBead(claimResult(command, result, isError))).toBeUndefined();
	},
);

test("recognizes nested bash claims and selects the last claimed bead", () => {
	const event = claimResult(
		"br update hv-9d9 hv-9d9.1 --claim --json",
		'[{"id":"hv-9d9","status":"in_progress"},{"id":"hv-9d9.1","status":"in_progress"}]',
	);
	event.parentToolCallId = "codemode";
	expect(claimedBead(event)).toBe("hv-9d9.1");
	expect(claimedBead({ ...event, toolName: "read" })).toBeUndefined();
});
