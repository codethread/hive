import { buildExplicitIdentityPrompt, resolveIdentity } from "./identity.ts";
import { z } from "zod";

const codexStartSchema = z.discriminatedUnion("hook_event_name", [
	z.object({
		hook_event_name: z.literal("SessionStart"),
		session_id: z.string().nonempty(),
		source: z.enum(["startup", "resume", "clear", "compact"]),
	}),
	z.object({
		hook_event_name: z.literal("SubagentStart"),
		session_id: z.string().nonempty(),
		agent_id: z.string().nonempty(),
	}),
]);

export function codexIdentityHook(input: unknown, env: NodeJS.ProcessEnv) {
	const event = codexStartSchema.parse(input);
	let session = event.session_id;
	let suppliedName = env.HIVE_AGENT_NAME;
	if (event.hook_event_name === "SubagentStart") {
		session = event.agent_id;
		suppliedName = undefined;
	} else if (env.HIVE_AGENT_SOURCE !== "bee" && env.HIVE_AGENT_SESSION) {
		suppliedName = undefined;
	}
	const identity = resolveIdentity(session, suppliedName);
	return {
		hookSpecificOutput: {
			hookEventName: event.hook_event_name,
			additionalContext: buildExplicitIdentityPrompt(identity.name),
		},
	};
}
