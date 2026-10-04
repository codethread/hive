import { CommandError, beads, showBead } from "@hive/shared";
import type { RepositoryEndpoint } from "@hive/shared";
import type { RequestRecord } from "./request.ts";

const CLAIM_CONFLICT = 4;
const STALE_CONFLICT = 6;

/** Claim only the task versions inspected by the daemon, preserving their human owner. */
// eslint-disable-next-line max-statements -- Reservation inspection and native conditional claim handling form one boundary.
export async function acquireClaim(
	repository: RepositoryEndpoint,
	identity: string,
	id: string,
): Promise<"claimed" | "closed" | "conflict"> {
	const task = await showBead(repository, identity, id);
	if (task.status === "closed") {
		return "closed";
	}
	if ((task.assignee && task.assignee !== identity) || task.labels.includes("hitl")) {
		return "conflict";
	}
	const owner: string[] = [];
	if (task.owner !== undefined) {
		owner.push("--owner", task.owner);
	}
	try {
		await beads(repository, identity, [
			"update",
			id,
			"--claim",
			"--if-unchanged",
			task.updated_at,
			...owner,
		]);
		return "claimed";
	} catch (error) {
		if (isClaimConflict(error)) {
			return "conflict";
		}
		throw error;
	}
}
/** Stopped execution is a caller precondition; never clear another identity's claim. */
export async function releaseClaims(
	repository: RepositoryEndpoint,
	record: RequestRecord,
): Promise<void> {
	for (const id of record.context.claims) {
		// eslint-disable-next-line no-await-in-loop -- Conditional releases are serialized against real tracker versions.
		const task = await showBead(repository, record.context.identity, id);
		if (task.status !== "closed" && task.assignee === record.context.identity) {
			const owner: string[] = [];
			if (task.owner !== undefined) {
				owner.push("--owner", task.owner);
			}
			// eslint-disable-next-line no-await-in-loop -- A stale version fails loudly and leaves the remaining claims intact.
			await beads(repository, record.context.identity, [
				"update",
				id,
				"--assignee",
				"",
				"--status",
				"open",
				"--if-unchanged",
				task.updated_at,
				...owner,
			]);
		}
	}
}

// --- Private functions ---
/** A native claim conflict is policy; every other command failure remains diagnostic. */
function isClaimConflict(error: unknown): boolean {
	return (
		error instanceof CommandError &&
		(error.code === CLAIM_CONFLICT || error.code === STALE_CONFLICT)
	);
}
