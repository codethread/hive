import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";

export interface Identity {
	/** Actual harness conversation key, independent of the actor. */
	session: string;
	/** Friendly actor, either supplied by Bee or derived from the session. */
	name: string;
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
