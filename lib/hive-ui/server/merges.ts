import type { BeadRow } from "@hive/beads";
import type { MergeLink } from "../contracts.ts";
import { mergeDescriptionSchema } from "../contracts.ts";

/** Interpret agent-authored merge records without making malformed content fatal to task reads. */
// eslint-disable-next-line max-statements -- Keep JSON, shape and lifecycle diagnostics in one interpretation.
export function mergeLink(bead: BeadRow): MergeLink {
	const identity = { id: bead.id, title: bead.title };
	let description: unknown = undefined;
	try {
		description = JSON.parse(bead.description);
	} catch {
		return { ...identity, kind: "invalid", problem: "Description is not valid JSON." };
	}
	const parsed = mergeDescriptionSchema.safeParse(description);
	if (!parsed.success) {
		return {
			...identity,
			kind: "invalid",
			problem: parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
		};
	}
	const expectedStatus = { active: "open", abandoned: "closed", merged: "closed" }[
		parsed.data.resolution
	];
	if (bead.status !== expectedStatus) {
		return {
			...identity,
			kind: "invalid",
			problem: `Resolution ${parsed.data.resolution} requires status ${expectedStatus}; recorded ${bead.status}.`,
		};
	}
	return { ...identity, ...parsed.data, kind: "valid" };
}
