import { expect, test } from "bun:test";
import { ZodError } from "zod";
import { codexIdentityHook } from "../src/codex.ts";
import { resolveIdentity } from "../src/identity.ts";

const sessionContext = {
	session_id: "native-session-a",
	cwd: "/code/worktree",
	transcript_path: "/sessions/native-session-a.jsonl",
	model: "native-model",
	permission_mode: "default",
};
const sessionStart = { ...sessionContext, hook_event_name: "SessionStart", source: "startup" };

test("startup, repeated start, clear, target resume and compact resolve the current session", () => {
	const env = Object.freeze({
		HIVE_AGENT_NAME: "old-native",
		HIVE_AGENT_SESSION: "old-session",
		HIVE_AGENT_SOURCE: "native",
		BD_ACTOR: "inherited-actor",
		BEADS_DB: "/selected/tracker.db",
		UNRELATED: "keep",
	});
	for (const [source, session] of [
		["startup", "native-session-a"],
		["startup", "native-session-a"],
		["clear", "native-session-b"],
		["resume", "native-session-a"],
		["compact", "native-session-a"],
	] as const) {
		const output = codexIdentityHook({ ...sessionStart, source, session_id: session }, env);
		expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
		const prompt = output.hookSpecificOutput.additionalContext;
		expect(prompt).toContain(`Your Hive identity is ${resolveIdentity(session).name}.`);
		expect(prompt).toContain(`--actor ${resolveIdentity(session).name}`);
	}
});

test.each([
	{ HIVE_AGENT_NAME: "interactive-bee", HIVE_AGENT_SESSION: "" },
	{ HIVE_AGENT_NAME: "managed-bee", HIVE_SPAWN_ID: "request" },
	{ HIVE_AGENT_NAME: "recreated-bee", HIVE_AGENT_SESSION: "old", HIVE_AGENT_SOURCE: "bee" },
])("supplied $HIVE_AGENT_NAME survives native session transitions", (supplied) => {
	const env = Object.freeze({
		...supplied,
		BD_ACTOR: supplied.HIVE_AGENT_NAME,
		BR_AGENT_NAME: "worker",
	});
	for (const source of ["startup", "clear", "resume", "compact"]) {
		const output = codexIdentityHook({ ...sessionStart, source, session_id: source }, env);
		expect(output.hookSpecificOutput.additionalContext).toContain(
			`--actor ${supplied.HIVE_AGENT_NAME}`,
		);
	}
});

test("native children override inherited actor and history without changing parent or siblings", () => {
	const env = Object.freeze({
		HIVE_AGENT_NAME: "parent-bee",
		BD_ACTOR: "parent-bee",
		HIVE_AGENT_SOURCE: "bee",
	});
	const parent = codexIdentityHook(sessionStart, env);
	for (const agentId of ["native-child-a", "native-child-b"]) {
		const output = codexIdentityHook(
			{
				...sessionContext,
				hook_event_name: "SubagentStart",
				agent_id: agentId,
				agent_type: "default",
				turn_id: "parent-turn",
			},
			env,
		);
		expect(output.hookSpecificOutput.hookEventName).toBe("SubagentStart");
		expect(output.hookSpecificOutput.additionalContext).toContain(
			`--actor ${resolveIdentity(agentId).name}`,
		);
		expect(output.hookSpecificOutput.additionalContext).not.toContain("parent-bee");
	}
	expect(codexIdentityHook(sessionStart, env)).toEqual(parent);
});

test.each([
	{ ...sessionStart, session_id: "" },
	{ ...sessionStart, source: "fork" },
	{ ...sessionStart, hook_event_name: "Stop" },
	{ ...sessionStart, hook_event_name: "SubagentStart" },
])("invalid hook input fails at the boundary: $hook_event_name $source", (input) => {
	expect(() => codexIdentityHook(input, {})).toThrow(ZodError);
});
