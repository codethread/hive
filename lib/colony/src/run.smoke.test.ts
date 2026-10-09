import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable repository and native harness fixture.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Isolate the real CLI fixture.
import { tmpdir } from "node:os";

const BEE = new URL("../bin/bee.ts", import.meta.url).pathname;
const HARNESS_EXIT = 23;
const SUCCESS = 0;
const EMPTY = 0;
const ROLE = 'Discuss "architecture".\nKeep this role.';

// eslint-disable-next-line max-statements -- One disposable repository and PTY verify the native process handoff end to end.
test("bee run replaces itself in the inherited terminal without a tracker or daemon", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "bee-run-"));
	const repo = await realpath(temporary);
	const cwd = join(repo, "nested");
	const output = join(repo, "observed.json");
	const harness = join(repo, "harness.ts");
	try {
		await execute(["git", "init"], repo, process.env);
		await mkdir(cwd);
		await Bun.write(
			harness,
			`
await Bun.write(process.env.BEE_RUN_OUTPUT, JSON.stringify({
  pid: process.pid, cwd: process.cwd(), argv: Bun.argv.slice(2),
  tty: [process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY],
  actor: process.env.BD_ACTOR, identity: process.env.HIVE_AGENT_NAME,
  kind: process.env.BR_AGENT_NAME, model: process.env.BR_MODEL, harness: process.env.BR_HARNESS,
  shell: process.env.BEE_RUN_INHERITED,
  authority: Object.keys(process.env).filter(key => key.startsWith("HIVE_") && key !== "HIVE_AGENT_NAME"),
  tracker: process.env.BEADS_DB,
}));
process.exit(${HARNESS_EXIT});
`,
		);
		await Bun.write(
			join(repo, ".hive", "bees.toml"),
			`owner="ct"
humans=["ct"]
[formulas.native]
headless=["--invalid-headless-option"]
executable=${JSON.stringify(process.execPath)}
argv=${JSON.stringify([harness, "{{system_prompt}}", "{{prompt}}"])}
[kinds.librarian]
description="Discuss architecture."
harness="native"
model="default-model"
effort="low"
system_prompt=${JSON.stringify(ROLE)}
`,
		);
		const child = Bun.spawn(
			[
				process.execPath,
				BEE,
				"run",
				"librarian",
				"--model",
				"selected-model",
				"--prompt",
				"Discuss the design",
			],
			{
				cwd,
				env: {
					...process.env,
					BEADS_DB: undefined,
					BEE_RUN_OUTPUT: output,
					BEE_RUN_INHERITED: "shell-value",
					HIVE_ATTEMPT_ID: "parent-attempt",
					HIVE_ATTEMPT_TOKEN: "parent-token",
					HIVE_SPAWN_ID: "parent-spawn",
				},
				terminal: {},
			},
		);
		try {
			expect(await child.exited).toBe(HARNESS_EXIT);
			const observed = await Bun.file(output).json();
			expect(observed).toMatchObject({
				pid: child.pid,
				cwd,
				argv: [ROLE, "Discuss the design"],
				tty: [true, true, true],
				kind: "librarian",
				model: "selected-model",
				harness: "native",
				shell: "shell-value",
				authority: [],
			});
			expect(observed.actor).toBe(observed.identity);
			expect(observed.identity).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
			expect(observed.tracker).toBeUndefined();
		} finally {
			child.kill();
			child.terminal?.close();
		}
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

test.each([
	{ args: ["run", "librarian"] },
	{ args: ["run", "librarian", "--json"] },
	{ args: ["--json", "run", "librarian"] },
	{ args: ["run", "librarian", "extra-task"] },
	{ args: ["run", "librarian", "--cwd", "/tmp"] },
])("bee run refuses missing terminals and incompatible CLI inputs: %j", async ({ args }) => {
	const child = Bun.spawn([process.execPath, BEE, ...args], {
		env: { ...process.env, BEADS_DB: undefined },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(code).not.toBe(SUCCESS);
	if (args.some((argument) => argument === "--json")) {
		expect(JSON.parse(stdout)).toMatchObject({ ok: false });
		expect(stderr).toBe("");
	} else {
		expect(stdout).toBe("");
		expect(stderr.length).toBeGreaterThan(EMPTY);
	}
});
