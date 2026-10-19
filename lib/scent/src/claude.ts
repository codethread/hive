import { buildExplicitIdentityPrompt, resolveIdentity } from "./identity.ts";
import { z } from "zod";

const claudeStartSchema = z.discriminatedUnion("hook_event_name", [
	z.object({
		hook_event_name: z.literal("SessionStart"),
		session_id: z.string().nonempty(),
		source: z.enum(["startup", "resume", "clear", "compact"]),
		model: z.string().nonempty().optional(),
	}),
	z.object({
		hook_event_name: z.literal("SubagentStart"),
		session_id: z.string().nonempty(),
		agent_id: z.string().nonempty(),
	}),
]);

export async function claudeIdentityHook(
	input: unknown,
	env: NodeJS.ProcessEnv,
	appendEnvironment: (path: string, contents: string) => Promise<void>,
) {
	const event = claudeStartSchema.parse(input, { jitless: true });
	if (event.hook_event_name === "SubagentStart") {
		return contextOutput(event.hook_event_name, resolveIdentity(event.agent_id).name);
	}
	const environmentFile = z.string().nonempty().parse(env.CLAUDE_ENV_FILE);
	const { identity, attributes } = sessionEnvironment(event.session_id, event.model, env);
	await appendEnvironment(environmentFile, renderEnvironment(attributes));
	return contextOutput(event.hook_event_name, identity.name);
}

// --- Private functions ---

function sessionEnvironment(session: string, model: string | undefined, env: NodeJS.ProcessEnv) {
	let suppliedName = env.HIVE_AGENT_NAME;
	if (env.HIVE_AGENT_SESSION) {
		suppliedName = undefined;
	}
	const identity = resolveIdentity(session, suppliedName);
	const attributes: Record<string, string | undefined> = {
		BD_ACTOR: identity.name,
		HIVE_AGENT_NAME: identity.name,
		HIVE_AGENT_SESSION: identity.session,
		HIVE_AGENT_SOURCE: "native",
		BR_HARNESS: "claude",
		BR_MODEL: model,
		BR_AGENT_NAME: undefined,
		BR_EFFORT: undefined,
	};
	if (suppliedName) {
		Object.assign(attributes, {
			HIVE_AGENT_SOURCE: "bee",
			BR_AGENT_NAME: env.BR_AGENT_NAME,
			BR_MODEL: model ?? env.BR_MODEL,
			BR_EFFORT: env.BR_EFFORT,
		});
	}
	return { identity, attributes };
}

function renderEnvironment(attributes: Record<string, string | undefined>): string {
	return `${Object.entries(attributes)
		.map(([key, value]) => {
			if (value === undefined) {
				return `unset ${key}`;
			}
			return `export ${key}='${value.replaceAll("'", String.raw`'\''`)}'`;
		})
		.join("\n")}\n`;
}

function contextOutput(hookEventName: "SessionStart" | "SubagentStart", name: string) {
	return {
		hookSpecificOutput: {
			hookEventName,
			additionalContext: buildExplicitIdentityPrompt(name),
		},
	};
}
