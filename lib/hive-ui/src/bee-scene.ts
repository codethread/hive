import type { Bee, Provenance } from "../contracts.ts";

const LAST = -1;

export interface BeeScene {
	/** Matching requests from the current inventory page. */
	matches: Bee[];
	/** Matching requests plus explicitly loaded historical context, keyed by native ID. */
	requests: Bee[];
	/** Name matches verified by the bounded ancestry query; still not recorded parent IDs. */
	inferred: { parent: string; child: string }[];
	/** Historical requests do not inflate the number of matches. */
	contextIds: Set<string>;
}

/** Render only loaded evidence; never infer uniqueness from one inventory page. */
// eslint-disable-next-line max-statements -- Merge only explicit ancestry evidence and retain the match/context distinction.
export function beeScene(bees: Bee[], query: string, ancestry: Provenance | null): BeeScene {
	const text = query.toLocaleLowerCase();
	const matches = bees.filter((bee) =>
		[bee.id, bee.identity, bee.kind, bee.requester ?? "", ...bee.taskIds].some((value) =>
			value.toLocaleLowerCase().includes(text),
		),
	);
	const requests = new Map(matches.map((bee) => [bee.id, bee]));
	const contextIds = new Set<string>();
	const inferred: BeeScene["inferred"] = [];
	for (const [index, bee] of (ancestry?.chain ?? []).entries()) {
		if (!requests.has(bee.id)) {
			contextIds.add(bee.id);
			requests.set(bee.id, bee);
		}
		const child = ancestry?.chain[index - 1];
		if (child) {
			inferred.push({ child: child.id, parent: bee.id });
		}
	}
	if (ancestry?.end.kind === "cycle") {
		const child = ancestry.chain.at(LAST)!;
		inferred.push({ child: child.id, parent: ancestry.end.id });
	}
	return { contextIds, inferred, matches, requests: [...requests.values()] };
}

// eslint-disable-next-line typescript/consistent-return -- Every variant of the provenance termination union returns a message.
export function ancestryEnding(end: Provenance["end"]): string {
	switch (end.kind) {
		case "unmatched": {
			return end.requester === null
				? "No requester was recorded."
				: `No matching request found for recorded requester “${end.requester}”. This does not identify a human root.`;
		}
		case "ambiguous": {
			return `Ambiguous requester “${end.requester}”; candidates include ${end.candidates.join(", ")}. No parent chosen.`;
		}
		case "cycle": {
			return `Cycle reaches ${end.id}; traversal stopped.`;
		}
		case "limit": {
			return "Stopped at the eight-request ancestry limit. More history may exist.";
		}
	}
}
