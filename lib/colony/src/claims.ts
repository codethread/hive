import { CommandError, beads, showBead } from "@hive/shared";
import type { OperationEvidence } from "./history.ts";
import type { RepositoryEndpoint } from "@hive/shared";
import type { RequestRecord } from "./request.ts";

/** Claim only the task versions inspected by the daemon, preserving their human owner. */
// eslint-disable-next-line max-statements, max-params -- Reservation inspection and native conditional claim handling form one boundary.
export async function acquireClaim(
	repository: RepositoryEndpoint,
	identity: string,
	id: string,
	evidence: OperationEvidence,
): Promise<"claimed" | "closed" | "conflict"> {
	evidence.step("tracker.show", id);
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
		evidence.step("tracker.claim", id);
		await beads(repository, identity, [
			"update",
			id,
			"--claim",
			"--if-unchanged",
			task.updated_at,
			...owner,
		]);
		evidence.completed("tracker.claimed", id);
		return "claimed";
	} catch (error) {
		evidence.failed(error);
		if (isClaimConflict(error)) {
			return "conflict";
		}
		throw error;
	}
}
/** Stopped execution is a caller precondition; never clear another identity's claim. */
// eslint-disable-next-line max-statements -- Each conditional release retains its successful effect before inspecting the next claim.
export async function releaseClaims(
	repository: RepositoryEndpoint,
	record: RequestRecord,
	evidence: OperationEvidence,
): Promise<void> {
	for (const id of record.context.claims) {
		evidence.step("tracker.show", id);
		// eslint-disable-next-line no-await-in-loop -- Conditional releases are serialized against real tracker versions.
		const task = await showBead(repository, record.context.identity, id);
		if (task.status !== "closed" && task.assignee === record.context.identity) {
			let { status } = task;
			if (status === "in_progress") {
				status = "open";
			}
			const owner: string[] = [];
			if (task.owner !== undefined) {
				owner.push("--owner", task.owner);
			}
			evidence.step("tracker.release", id);
			// eslint-disable-next-line no-await-in-loop -- A stale version fails loudly and leaves the remaining claims intact.
			await beads(repository, record.context.identity, [
				"update",
				id,
				"--assignee",
				"",
				"--status",
				status,
				"--if-unchanged",
				task.updated_at,
				...owner,
			]);
			evidence.completed("tracker.released", id);
		}
	}
}

// --- Private functions ---
/** A native claim conflict is policy; every other command failure remains diagnostic. */
function isClaimConflict(error: unknown): boolean {
	return (
		error instanceof CommandError &&
		(error.nativeError?.code === "UPDATE_PRECONDITION_FAILED" ||
			(error.nativeError?.code === "VALIDATION_FAILED" &&
				error.nativeError.context?.field === "claim"))
	);
}
