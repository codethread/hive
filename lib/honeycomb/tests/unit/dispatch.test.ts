import { expect, test } from "bun:test";
import { dispatch } from "../../src/main.ts";
import type { Deps } from "../../src/services.ts";

const unexpectedIO = (): never => {
	throw new Error("Usage must not invoke services");
};
const deps: Deps = {
	git: { run: unexpectedIO, runRaw: unexpectedIO },
	config: { read: unexpectedIO, explain: unexpectedIO },
	files: {
		normalizePath: unexpectedIO,
		exists: unexpectedIO,
		prepareParent: unexpectedIO,
		copy: unexpectedIO,
		writePostCreateScript: unexpectedIO,
	},
	hooks: { runInline: unexpectedIO, runCommand: unexpectedIO },
	picker: { pick: unexpectedIO, confirm: unexpectedIO },
	progress: { banner: unexpectedIO, stream: unexpectedIO, error: unexpectedIO },
	clock: { now: unexpectedIO },
	internalRollback: false,
};

test.each([
	{ name: "missing command", command: undefined, exitCode: 0, stream: "stdout" },
	{ name: "--help", command: "--help", exitCode: 0, stream: "stdout" },
	{ name: "-h", command: "-h", exitCode: 0, stream: "stdout" },
	{ name: "unknown command", command: "somebogus", exitCode: 12, stream: "stderr" },
] as const)(
	"dispatch $name returns usage with exit code $exitCode",
	async ({ command, exitCode, stream }) => {
		expect(await dispatch(command, [], deps)).toEqual({
			exitCode,
			[stream]: expect.stringContaining("Usage: honeycomb <subcommand>"),
		});
	},
);
