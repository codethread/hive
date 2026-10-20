import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "bun:test";
import { installPiIdentity } from "../src/pi.ts";
import { resolveIdentity } from "../src/identity.ts";

test("startup, clear, resume and compact refresh attribution and one owned section", () => {
	const env = { BEADS_DB: "/selected/tracker.db", UNRELATED: "keep" };
	const host = fixture(env);
	const event = promptEvent();
	for (const session of ["first", "first", "new", "first", "first"]) {
		host.ctx.sessionManager = { getSessionId: () => session } as ExtensionContext["sessionManager"];
		host.emit("session_start", {}, host.ctx);
		host.emit("before_agent_start", event, host.ctx);
		assertIdentity(env, session, event);
	}
	expect(event.systemPromptOptions.sections.other).toBe("Other extension policy");
	expect(env).toMatchObject({
		BEADS_DB: "/selected/tracker.db",
		UNRELATED: "keep",
		BR_HARNESS: "pi",
	});
});

test.each([
	{ HIVE_AGENT_NAME: "interactive-bee", HIVE_AGENT_SESSION: "", BR_AGENT_NAME: "worker" },
	{ HIVE_AGENT_NAME: "managed-bee", HIVE_SPAWN_ID: "request", BR_AGENT_NAME: "reviewer" },
])("adopts supplied $HIVE_AGENT_NAME and kind across conversation transitions", (supplied) => {
	const env: NodeJS.ProcessEnv = { ...supplied };
	for (const session of ["initial", "new", "resumed"]) {
		const host = fixture(env);
		host.ctx.sessionManager = { getSessionId: () => session } as ExtensionContext["sessionManager"];
		host.emit("session_start", {}, host.ctx);
		expect(env.BD_ACTOR).toBe(supplied.HIVE_AGENT_NAME);
		expect(env.BR_AGENT_NAME).toBe(supplied.BR_AGENT_NAME);
		expect(env.HIVE_AGENT_SESSION).toBe(session);
	}
});

test("inherited native binding is replaced and unknown attributes remove stale metadata", () => {
	const env: NodeJS.ProcessEnv = {
		HIVE_AGENT_NAME: "old-native",
		HIVE_AGENT_SESSION: "old-session",
		BR_AGENT_NAME: "stale-kind",
		BR_MODEL: "stale-model",
		BR_EFFORT: "stale-effort",
	};
	const host = fixture(env);
	host.emit("session_start", {}, host.ctx);
	expect(env).toEqual({
		BD_ACTOR: resolveIdentity("first").name,
		HIVE_AGENT_NAME: resolveIdentity("first").name,
		HIVE_AGENT_SESSION: "first",
		HIVE_AGENT_SOURCE: "native",
		BR_HARNESS: "pi",
	});
});

test("runtime model and thinking metadata refresh and become absent when unknown #test-548", () => {
	const env: NodeJS.ProcessEnv = {};
	const host = fixture(env);
	host.ctx.model = { provider: "provider", id: "model" } as NonNullable<ExtensionContext["model"]>;
	host.ctx.thinkingLevel = "high";
	host.emit("before_agent_start", promptEvent(), host.ctx);
	expect(env).toMatchObject({ BR_MODEL: "provider/model", BR_EFFORT: "high" });
	host.ctx.model = undefined;
	delete host.ctx.thinkingLevel;
	host.emit("model_select", {}, host.ctx);
	expect(env).toEqual({
		BD_ACTOR: resolveIdentity("first").name,
		HIVE_AGENT_NAME: resolveIdentity("first").name,
		HIVE_AGENT_SESSION: "first",
		HIVE_AGENT_SOURCE: "native",
		BR_HARNESS: "pi",
	});
});

test("UI status follows session identity and clears on shutdown", () => {
	const env: NodeJS.ProcessEnv = {};
	const host = fixture(env, true);
	for (const session of ["first", "new"]) {
		host.ctx.sessionManager = { getSessionId: () => session } as ExtensionContext["sessionManager"];
		host.emit("session_start", {}, host.ctx);
		expect(env.BD_ACTOR).toBe(resolveIdentity(session).name);
	}
	host.emit("session_shutdown", {}, host.ctx);
	expect(host.statusUpdates).toEqual([
		["scent-identity", resolveIdentity("first").name],
		["scent-identity", resolveIdentity("new").name],
		["scent-identity", undefined],
	]);
});

test("headless sessions do not publish UI status", () => {
	const host = fixture({});
	host.emit("session_start", {}, host.ctx);
	host.emit("session_shutdown", {}, host.ctx);
	expect(host.statusUpdates).toEqual([]);
});

function fixture(env: NodeJS.ProcessEnv, hasUI = false) {
	type Handler = (event: never, ctx: ExtensionContext) => unknown;
	const handlers = new Map<string, Handler>();
	const on = ((name: string, handler: Handler) => {
		handlers.set(name, handler);
		return () => {
			handlers.delete(name);
		};
	}) as ExtensionAPI["on"];
	installPiIdentity({ on }, env);
	const statusUpdates: [string, string | undefined][] = [];
	const ctx = {
		hasUI,
		ui: { setStatus: (key: string, text: string | undefined) => statusUpdates.push([key, text]) },
		sessionManager: { getSessionId: () => "first" },
	} as unknown as ExtensionContext;
	return {
		ctx,
		statusUpdates,
		emit(name: string, event: unknown, context: ExtensionContext) {
			const handler = handlers.get(name);
			if (!handler) {
				throw new Error(`Missing handler: ${name}`);
			}
			return handler(event as never, context);
		},
	};
}

function assertIdentity(
	env: NodeJS.ProcessEnv,
	session: string,
	event: BeforeAgentStartEvent,
): void {
	const expected = resolveIdentity(session).name;
	expect(env).toMatchObject({
		BD_ACTOR: expected,
		HIVE_AGENT_NAME: expected,
		HIVE_AGENT_SESSION: session,
	});
	expect(event.systemPromptOptions.sections.scent).toContain(expected);
	expect(Object.keys(event.systemPromptOptions.sections)).toEqual(["other", "scent"]);
}

function promptEvent(): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		messageType: "user",
		prompt: "work",
		systemPrompt: "base policy",
		systemPromptOptions: {
			cwd: "/code",
			selectedTools: [],
			hiddenTools: [],
			toolSnippets: {},
			toolGuidelines: {},
			promptGuidelines: [],
			appendSystemPrompt: "",
			sections: { other: "Other extension policy" },
			contextFiles: [],
			skills: [],
		},
	};
}
