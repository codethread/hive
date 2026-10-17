import { expect, test } from "bun:test";
import { CommanderError } from "commander";
import type { UiOptions } from "../../server/cli.ts";
import { createUiCommand } from "../../server/cli.ts";
import { version } from "../../package.json";

const selectedDb = "/selected/beads.db";

test.each([
	{
		name: "default startup",
		argv: [],
		expected: {
			beadsDb: selectedDb,
			daemon: false,
			host: "127.0.0.1",
			json: false,
			port: 4318,
			repo: ".",
		},
	},
	{
		name: "daemon startup with machine options",
		argv: [
			"--daemon",
			"--state",
			"/daemon",
			"--socket",
			"/daemon/socket",
			"--port",
			"0",
			"--json",
			"--log-file",
			"ui.jsonl",
		],
		expected: {
			daemon: true,
			state: "/daemon",
			socket: "/daemon/socket",
			port: 0,
			json: true,
			logFile: "ui.jsonl",
		},
	},
])("$name invokes the server action", async ({ argv, expected }) => {
	const { program, starts, output } = harness();
	await program.parseAsync(argv, { from: "user" });
	expect(starts).toHaveLength(1);
	expect(starts[0]).toMatchObject(expected);
	expect(output).toEqual([]);
});

test("awaits and propagates asynchronous server startup failure", async () => {
	const program = createUiCommand({
		beadsDb: selectedDb,
		start: () => Promise.reject(new TypeError("startup failed")),
		write() {},
	});
	const result = await program.parseAsync([], { from: "user" }).catch((error: unknown) => error);
	expect(result).toBeInstanceOf(TypeError);
});

test.each(["--help", "--version"])("%s exits without server startup", async (flag) => {
	const { program, starts, output } = harness();
	const result = await program
		.parseAsync([flag], { from: "user" })
		.catch((error: unknown) => error);
	expect(result).toBeInstanceOf(CommanderError);
	expect(result).toMatchObject({ exitCode: 0 });
	expect(starts).toEqual([]);
	expect(output.join("")).not.toBe("");
});

test("changelog reads embedded history without starting the server", async () => {
	const { program, starts, output } = harness();
	await program.parseAsync(["changelog", "--json"], { from: "user" });
	expect(starts).toEqual([]);
	expect(JSON.parse(output.join(""))).toMatchObject({
		ok: true,
		kind: "changelog",
		tool: "hive-ui",
		installedVersion: version,
	});
});

// --- Private helpers ---

function harness() {
	const starts: UiOptions[] = [];
	const output: string[] = [];
	const program = createUiCommand({
		beadsDb: selectedDb,
		start(options) {
			starts.push(options);
			return Promise.resolve();
		},
		write(text) {
			output.push(text);
		},
	});
	return { program, starts, output };
}
