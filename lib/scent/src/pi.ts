import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveIdentity } from "./identity.ts";

function buildIdentityPrompt(name: string): string {
	return `Your Hive identity is ${name}. Beads mutations use this identity through BD_ACTOR.`;
}

/** Install the native Pi callbacks; the entry point supplies the process environment. */
export function installPiIdentity(pi: Pick<ExtensionAPI, "on">, env: NodeJS.ProcessEnv): void {
	const { name: suppliedName, kind: suppliedKind } = suppliedIdentity(env);
	const refresh = (ctx: ExtensionContext) => {
		const identity = resolveIdentity(ctx.sessionManager.getSessionId(), suppliedName);
		Object.assign(env, {
			HIVE_AGENT_NAME: identity.name,
			HIVE_AGENT_SESSION: identity.session,
			HIVE_AGENT_SOURCE: "native",
			BD_ACTOR: identity.name,
			BR_HARNESS: "pi",
		});
		if (suppliedName) {
			env.HIVE_AGENT_SOURCE = "bee";
		}
		setAttribute(env, "BR_AGENT_NAME", suppliedKind);
		setAttribute(env, "BR_MODEL", nativeModel(ctx));
		setAttribute(env, "BR_EFFORT", ctx.thinkingLevel);
		if (ctx.hasUI) {
			ctx.ui.setStatus("scent-identity", identity.name);
		}
		return identity;
	};
	pi.on("session_start", (_event, ctx) => {
		refresh(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("scent-identity", undefined);
		}
	});
	pi.on("model_select", (_event, ctx) => {
		refresh(ctx);
	});
	pi.on("thinking_level_select", (_event, ctx) => {
		refresh(ctx);
	});
	pi.on("before_agent_start", (event, ctx) => {
		const identity = refresh(ctx);
		event.systemPromptOptions.sections.scent = buildIdentityPrompt(identity.name);
	});
}

// --- Private functions ---

function suppliedIdentity(env: NodeJS.ProcessEnv) {
	// Pi recreates extensions on session switches; retain supplied Bee provenance.
	if (env.HIVE_AGENT_SOURCE !== "bee" && env.HIVE_AGENT_SESSION) {
		return { name: undefined, kind: undefined };
	}
	return { name: env.HIVE_AGENT_NAME, kind: env.BR_AGENT_NAME };
}

function setAttribute(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
	if (value === undefined) {
		delete env[key];
	} else {
		env[key] = value;
	}
}

function nativeModel(ctx: ExtensionContext): string | undefined {
	if (ctx.model) {
		return `${ctx.model.provider}/${ctx.model.id}`;
	}
	return undefined;
}
