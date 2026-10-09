import { expect, test } from "bun:test";
import type { Invocation } from "@hive/shared";
import type { RunRuntime } from "./run.ts";
import { parseBeesConfig } from "@hive/shared";
import { runKind } from "./run.ts";

const config = parseBeesConfig(`owner="ct"
humans=["ct"]
[formulas.native]
headless=["--print"]
executable="interactive"
argv=["{{model}}", "{{effort}}", "{{system_prompt}}", "{{prompt}}", "{{cwd}}"]
[formulas.alternate]
headless=["exec"]
executable="other-interactive"
argv=["{{model}}", "{{effort}}", "{{system_prompt}}", "{{prompt}}"]
[kinds.librarian]
description="Discuss architecture."
harness="native"
model="default-model"
effort="low"
system_prompt="Role instructions"
prompt=""
`);
const CURRENT_DIRECTORY = "/repo/worktree/subdirectory";
const FIRST = 0;
const ONE_LAUNCH = 1;
const inherited = {
	BD_ACTOR: "old-actor",
	BEADS_DB: "/selected/tracker.db",
	HIVE_AGENT_NAME: "old-identity",
	HIVE_ATTEMPT_ID: "old-attempt",
	HIVE_ATTEMPT_TOKEN: "old-token",
	HIVE_SPAWN_ID: "old-spawn",
	PATH: "/bin",
	SHELL_VALUE: "inherited",
};

// Warm schemas and rendering outside the unit-test timing window.
await runKind("librarian", {}, fixture().runtime);

test("interactive run inherits the directory and shell with fresh attribution, without request authority", async () => {
	const { runtime, launches } = fixture();
	await runKind("librarian", {}, runtime);
	expect(launches).toHaveLength(ONE_LAUNCH);
	const launch = launches.at(FIRST)!;
	expect(launch.invocation).toEqual({
		executable: "interactive",
		argv: ["default-model", "low", "Role instructions", CURRENT_DIRECTORY],
	});
	expect(launch.env).toMatchObject({
		BEADS_DB: inherited.BEADS_DB,
		BR_AGENT_NAME: "librarian",
		BR_HARNESS: "native",
		BR_MODEL: "default-model",
		SHELL_VALUE: "inherited",
		HIVE_ATTEMPT_ID: undefined,
		HIVE_ATTEMPT_TOKEN: undefined,
		HIVE_SPAWN_ID: undefined,
	});
	expect(launch.env["HIVE_AGENT_NAME"]).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
	expect(launch.env["BD_ACTOR"]).toBe(launch.env["HIVE_AGENT_NAME"]);
	expect(inherited.HIVE_AGENT_NAME).toBe("old-identity");
});

test("interactive overrides independently replace kind defaults and need no tracker", async () => {
	const { runtime, launches } = fixture();
	runtime.env = {};
	await runKind(
		"librarian",
		{
			harness: "alternate",
			model: "other-model",
			effort: "high",
			prompt: "Discuss this design",
			systemPrompt: "Different role",
		},
		runtime,
	);
	expect(launches.at(FIRST)).toMatchObject({
		invocation: {
			executable: "other-interactive",
			argv: ["other-model", "high", "Different role", "Discuss this design"],
		},
		env: { BR_HARNESS: "alternate", BR_MODEL: "other-model" },
	});
	expect(launches.at(FIRST)!.env["BEADS_DB"]).toBeUndefined();
});

test("missing terminal fails before configuration discovery or launch", async () => {
	const { runtime, launches } = fixture();
	runtime.terminal = false;
	let discovered = false;
	runtime.loadConfig = () => {
		discovered = true;
		return Promise.resolve({ config, warnings: [] });
	};
	await expect(runKind("librarian", {}, runtime)).rejects.toBeInstanceOf(Error);
	expect(discovered).toBe(false);
	expect(launches).toEqual([]);
});

test.each([
	{ kind: "missing", options: {} },
	{ kind: "librarian", options: { harness: "missing" } },
])("unconfigured interactive selection fails: %j", async ({ kind, options }) => {
	const { runtime, launches } = fixture();
	await expect(runKind(kind, options, runtime)).rejects.toBeInstanceOf(Error);
	expect(launches).toEqual([]);
});

// --- Private functions ---
function fixture() {
	const launches: { invocation: Invocation; env: NodeJS.ProcessEnv }[] = [];
	const runtime: RunRuntime = {
		cwd: CURRENT_DIRECTORY,
		env: inherited,
		terminal: true,
		loadConfig: () => Promise.resolve({ config, warnings: [] }),
		replace: (invocation, env) => {
			launches.push({ invocation, env });
		},
		warn: () => {},
	};
	return { runtime, launches };
}
