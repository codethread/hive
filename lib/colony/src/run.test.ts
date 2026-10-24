import type { BeesConfig, Invocation } from "@hive/shared";
import { expect, test } from "bun:test";
import { RESPONSE_PROTOCOL } from "./response-protocol.ts";
import type { RunRuntime } from "./run.ts";
import { runKind } from "./run.ts";

const config: BeesConfig = {
	owner: "ct",
	humans: ["ct"],
	formulas: {
		native: {
			headless: ["--print"],
			executable: "interactive",
			argv: ["{{model}}", "{{effort}}", "{{system_prompt}}", "{{prompt}}", "{{cwd}}"],
		},
		alternate: {
			headless: ["exec"],
			executable: "~/other-interactive",
			argv: ["{{model}}", "{{effort}}", "{{system_prompt}}", "{{prompt}}"],
		},
	},
	kinds: {
		librarian: {
			description: "Discuss architecture.",
			harness: "native",
			model: "default-model",
			effort: "low",
			system_prompt: "Role instructions",
			prompt: "",
			hidden: false,
			workflow: "do-work",
		},
	},
	limits: { colony: 4, kind: 2, kinds: {}, worktree: 2 },
	max_retries: 3,
	ranking: "bv-pagerank",
	retry_delay_ms: 250,
};
const CURRENT_DIRECTORY = "/repo/worktree/subdirectory";
const FIRST = 0;
const ONE_LAUNCH = 1;
const inherited = {
	BD_ACTOR: "old-actor",
	BEADS_DB: "/selected/tracker.db",
	HIVE_AGENT_NAME: "old-identity",
	HIVE_AGENT_SESSION: "inherited-native-session",
	HIVE_AGENT_SOURCE: "native",
	HIVE_ATTEMPT_ID: "old-attempt",
	HIVE_ATTEMPT_TOKEN: "old-token",
	HIVE_SPAWN_ID: "old-spawn",
	PATH: "/bin",
	SHELL_VALUE: "inherited",
};

test(
	"interactive run inherits the directory and shell with fresh attribution, without " +
		"request authority #test-477",
	async () => {
		const { runtime, launches } = fixture();
		await runKind("librarian", {}, runtime);
		expect(launches).toHaveLength(ONE_LAUNCH);
		const launch = launches.at(FIRST)!;
		expect(launch.invocation).toEqual({
			executable: "interactive",
			argv: [
				"default-model",
				"low",
				`Role instructions\n\n${RESPONSE_PROTOCOL}`,
				CURRENT_DIRECTORY,
			],
		});
		expect(launch.env).toMatchObject({
			BEADS_DB: inherited.BEADS_DB,
			BR_AGENT_NAME: "librarian",
			BR_HARNESS: "native",
			BR_MODEL: "default-model",
			HIVE_AGENT_SESSION: "",
			HIVE_AGENT_SOURCE: "bee",
			SHELL_VALUE: "inherited",
			HIVE_ATTEMPT_ID: undefined,
			HIVE_ATTEMPT_TOKEN: undefined,
			HIVE_SPAWN_ID: undefined,
		});
		expect(launch.env["HIVE_AGENT_NAME"]).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
		expect(launch.env["BD_ACTOR"]).toBe(launch.env["HIVE_AGENT_NAME"]);
		expect(inherited.HIVE_AGENT_NAME).toBe("old-identity");
	},
);

test.each([
	{
		systemPrompt: "Different role",
		expectedSystemPrompt: `Different role\n\n${RESPONSE_PROTOCOL}`,
	},
	{ systemPrompt: "", expectedSystemPrompt: RESPONSE_PROTOCOL },
])(
	"interactive overrides retain response guidance with role '$systemPrompt' and need no tracker #test-469",
	async ({ systemPrompt, expectedSystemPrompt }) => {
		const { runtime, launches } = fixture();
		runtime.env = {};
		await runKind(
			"librarian",
			{
				harness: "alternate",
				model: "other-model",
				effort: "high",
				prompt: "Discuss this design",
				systemPrompt,
			},
			runtime,
		);
		expect(launches.at(FIRST)).toMatchObject({
			invocation: {
				executable: "/users/test home/other-interactive",
				argv: ["other-model", "high", expectedSystemPrompt, "Discuss this design"],
			},
			env: { BR_HARNESS: "alternate", BR_MODEL: "other-model" },
		});
		expect(launches.at(FIRST)!.env["BEADS_DB"]).toBeUndefined();
		expect(config.kinds["librarian"]!.system_prompt).toBe("Role instructions");
	},
);

test("missing terminal fails before configuration discovery or launch #test-398", async () => {
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
])("unconfigured interactive selection fails: %j #test-565", async ({ kind, options }) => {
	const { runtime, launches } = fixture();
	await expect(runKind(kind, options, runtime)).rejects.toBeInstanceOf(Error);
	expect(launches).toEqual([]);
});

// --- Private functions ---
function fixture() {
	const launches: { invocation: Invocation; env: NodeJS.ProcessEnv }[] = [];
	const runtime: RunRuntime = {
		cwd: CURRENT_DIRECTORY,
		home: "/users/test home",
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
