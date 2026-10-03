import { expect, test } from "bun:test";
import type { Deps } from "../../src/services.ts";
import { dispatch } from "../../src/main.ts";

const unexpectedIO = (): never => {
	throw new Error("Usage must not invoke services");
};
const deps: Deps = {
	cdDirective: { write: unexpectedIO },
	clock: { now: unexpectedIO },
	config: { explain: unexpectedIO, read: unexpectedIO },
	files: {
		copy: unexpectedIO,
		exists: unexpectedIO,
		normalizePath: unexpectedIO,
		prepareParent: unexpectedIO,
		writePostCreateScript: unexpectedIO,
	},
	git: { run: unexpectedIO, runRaw: unexpectedIO },
	hooks: { runCommand: unexpectedIO, runInline: unexpectedIO },
	multiplexer: {
		attached: false,
		closeUnder: unexpectedIO,
		open: unexpectedIO,
		previewCommand: unexpectedIO,
	},
	picker: { confirm: unexpectedIO, pick: unexpectedIO },
	progress: { banner: unexpectedIO, error: unexpectedIO, stream: unexpectedIO },
};

test.each([
	{ command: undefined, exitCode: 0, name: "missing command", stream: "stdout" },
	{ command: "--help", exitCode: 0, name: "--help", stream: "stdout" },
	{ command: "-h", exitCode: 0, name: "-h", stream: "stdout" },
	{ command: "somebogus", exitCode: 12, name: "unknown command", stream: "stderr" },
] as const)(
	"dispatch $name returns usage with exit code $exitCode",
	async ({ command, exitCode, stream }) => {
		expect(await dispatch(command, [], deps)).toEqual({
			exitCode,
			[stream]: expect.stringContaining("Usage: honeycomb <subcommand>"),
		});
	},
);
