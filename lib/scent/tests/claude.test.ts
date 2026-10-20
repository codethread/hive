import { expect, test } from "bun:test";
import { ZodError } from "zod";
import { claudeIdentityHook } from "../src/claude.ts";
import { resolveIdentity } from "../src/identity.ts";

const FIRST = 0;
const CONTENTS = 1;

const sessionStart = {
	hook_event_name: "SessionStart",
	session_id: "session-a",
	source: "startup",
};

test.each([
	["startup", "session-a"],
	["clear", "session-b"],
	["resume", "session-a"],
	["compact", "session-a"],
])(
	"%s replaces stale native state and preserves the selected tracker #test-593",
	async (source, session) => {
		const env = Object.freeze({
			CLAUDE_ENV_FILE: "/session/env",
			HIVE_AGENT_NAME: "old-native",
			HIVE_AGENT_SESSION: "old-session",
			HIVE_AGENT_SOURCE: "native",
			BR_MODEL: "old-model",
			BR_AGENT_NAME: "old-kind",
			BR_EFFORT: "old-effort",
			BEADS_DB: "/selected/tracker.db",
		});
		const host = fixture(env);
		const output = await host.run({ ...sessionStart, source, session_id: session });
		const { name } = resolveIdentity(session);
		expect(output.hookSpecificOutput.additionalContext).toContain(`--actor ${name}`);
		expect(host.writes).toEqual([
			[
				"/session/env",
				`export BD_ACTOR='${name}'\nexport HIVE_AGENT_NAME='${name}'\n` +
					`export HIVE_AGENT_SESSION='${session}'\nexport HIVE_AGENT_SOURCE='native'\n` +
					"export BR_HARNESS='claude'\nunset BR_MODEL\nunset BR_AGENT_NAME\nunset BR_EFFORT\n",
			],
		]);
	},
);

test.each([
	{ HIVE_AGENT_NAME: "interactive-bee", HIVE_AGENT_SESSION: "" },
	{ HIVE_AGENT_NAME: "managed-bee", HIVE_AGENT_SOURCE: "bee" },
])("supplied $HIVE_AGENT_NAME and launcher metadata survive transitions", async (supplied) => {
	const env = Object.freeze({
		...supplied,
		CLAUDE_ENV_FILE: "/session/env",
		BR_AGENT_NAME: "worker",
		BR_MODEL: "launcher-model",
		BR_EFFORT: "low",
	});
	await Promise.all(
		["startup", "clear", "resume", "compact"].map(async (source) => {
			const host = fixture(env);
			const output = await host.run({ ...sessionStart, source, session_id: source });
			const contents = host.writes[FIRST]?.[CONTENTS];
			expect(output.hookSpecificOutput.additionalContext).toContain(
				`--actor ${supplied.HIVE_AGENT_NAME}`,
			);
			expect(contents).toContain(`export HIVE_AGENT_SESSION='${source}'`);
			expect(contents).toContain("export HIVE_AGENT_SOURCE='bee'");
			expect(contents).toContain("export BR_MODEL='launcher-model'");
			expect(contents).toContain("export BR_AGENT_NAME='worker'");
			expect(contents).toContain("export BR_EFFORT='low'");
		}),
	);
});

test("separate native CLI replaces inherited Bee binding and drops its kind and metadata", async () => {
	const host = fixture(
		Object.freeze({
			CLAUDE_ENV_FILE: "/session/env",
			HIVE_AGENT_NAME: "parent-bee",
			HIVE_AGENT_SOURCE: "bee",
			HIVE_AGENT_SESSION: "parent-session",
			BD_ACTOR: "parent-bee",
			BR_AGENT_NAME: "worker",
			BR_MODEL: "parent-model",
			BR_EFFORT: "low",
		}),
	);
	const output = await host.run(sessionStart);
	expect(output.hookSpecificOutput.additionalContext).toContain(
		`--actor ${resolveIdentity("session-a").name}`,
	);
	const contents = host.writes[FIRST]?.[CONTENTS];
	expect(contents).toContain("export HIVE_AGENT_SOURCE='native'");
	expect(contents).toContain("unset BR_AGENT_NAME\nunset BR_EFFORT");
	expect(contents).toContain("unset BR_MODEL");
});

test("observed model wins and shell exports quote supplied values literally", async () => {
	const name = "bee'$(touch nope)`echo nope`";
	const host = fixture({ CLAUDE_ENV_FILE: "/session/env", HIVE_AGENT_NAME: name, BR_MODEL: "old" });
	const output = await host.run({ ...sessionStart, model: "claude-haiku" });
	expect(output.hookSpecificOutput.additionalContext).toContain(`--actor ${name}`);
	expect(host.writes[FIRST]?.[CONTENTS]).toContain(
		"export HIVE_AGENT_NAME='bee'\\''$(touch nope)`echo nope`'",
	);
	expect(host.writes[FIRST]?.[CONTENTS]).toContain("export BR_MODEL='claude-haiku'");
});

test("children receive distinct explicit actors without changing the shared environment", async () => {
	const host = fixture(Object.freeze({ BD_ACTOR: "parent", HIVE_AGENT_NAME: "parent" }));
	await Promise.all(
		["child-a", "child-b"].map(async (agentId) => {
			const output = await host.run({
				hook_event_name: "SubagentStart",
				session_id: "parent-session",
				agent_id: agentId,
			});
			expect(output.hookSpecificOutput.hookEventName).toBe("SubagentStart");
			expect(output.hookSpecificOutput.additionalContext).toContain(
				`--actor ${resolveIdentity(agentId).name}`,
			);
		}),
	);
	expect(host.writes).toEqual([]);
});

test.each([
	{ ...sessionStart, session_id: "" },
	{ ...sessionStart, source: "fork" },
	{ ...sessionStart, hook_event_name: "SubagentStart" },
])("invalid hook inputs fail before environment writes", async (input) => {
	const host = fixture({ CLAUDE_ENV_FILE: "/session/env" });
	await expect(host.run(input)).rejects.toBeInstanceOf(ZodError);
	expect(host.writes).toEqual([]);
});

test("missing environment route and failed writes fail loudly", async () => {
	await expect(fixture({}).run(sessionStart)).rejects.toBeInstanceOf(ZodError);
	const error = new Error("unwritable environment file");
	await expect(
		claudeIdentityHook(sessionStart, { CLAUDE_ENV_FILE: "/session/env" }, () =>
			Promise.reject(error),
		),
	).rejects.toBe(error);
});

function fixture(env: NodeJS.ProcessEnv) {
	const writes: [string, string][] = [];
	return {
		writes,
		run(input: unknown) {
			return claudeIdentityHook(input, env, (path, contents) => {
				writes.push([path, contents]);
				return Promise.resolve();
			});
		},
	};
}
