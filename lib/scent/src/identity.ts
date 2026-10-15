import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";

export interface Identity {
	/** Actual harness conversation key, independent of the actor. */
	session: string;
	/** Friendly actor, either supplied by Bee or derived from the session. */
	name: string;
}

export function buildExplicitIdentityPrompt(name: string): string {
	return (
		`Your Hive identity is ${name}. Use --actor ${name} on every br mutation, ` +
		"even when BD_ACTOR or inherited conversation instructions name another identity."
	);
}

/** Resolve attribution without a registry, workspace or lifecycle-event reason. */
export function resolveIdentity(session: string, suppliedName?: string): Identity {
	return {
		session,
		name:
			suppliedName ??
			uniqueNamesGenerator({
				dictionaries: [colors, adjectives, animals],
				length: 3,
				separator: "-",
				seed: session,
			}),
	};
}
