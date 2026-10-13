import { eq, prerelease, satisfies, valid } from "semver";
import { z } from "zod";

const versionStart = /^\d/u;
export const workflowVersionSchema = z.compile(
	z
		.string()
		.trim()
		.regex(versionStart)
		.refine((value) => valid(value) !== null, "Expected a full semantic version"),
);

/** A saved run may move forward within its author's declared compatibility range. */
export function compatibleWorkflowVersion(saved: string, proposed: string): boolean {
	if (prerelease(saved) || prerelease(proposed)) {
		return eq(saved, proposed);
	}
	return satisfies(proposed, `^${saved}`);
}
