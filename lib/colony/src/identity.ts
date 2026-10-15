import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";
import type { Recipe } from "@hive/shared";

const NAME_WORDS = 3;

/** Mint attribution independently of requests, attempts and harness sessions. */
export function createIdentity(): string {
	return uniqueNamesGenerator({
		dictionaries: [colors, adjectives, animals],
		length: NAME_WORDS,
		separator: "-",
	});
}

/** Common attribution for both interactive and Colony-managed harnesses. */
export function agentEnvironment(identity: string, recipe: Recipe): Record<string, string> {
	return {
		BD_ACTOR: identity,
		BR_AGENT_NAME: recipe.kind,
		BR_HARNESS: recipe.harness,
		BR_MODEL: recipe.model,
		HIVE_AGENT_NAME: identity,
		HIVE_AGENT_SESSION: "",
		HIVE_AGENT_SOURCE: "bee",
	};
}
