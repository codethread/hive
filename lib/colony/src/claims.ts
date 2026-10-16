import { CommandError } from "@hive/beads";
import type { OperationEvidence } from "./history.ts";
import type { RequestRecord } from "./request.ts";
import type { TrackerContext } from "./tracker.ts";
import { trackerScope } from "./tracker.ts";

/** Claim only the task versions inspected by the daemon, preserving their human owner. */
/* eslint-disable-next-line max-statements, max-params --
 * Reservation inspection and native conditional claim handling form one boundary.
 */
export async function acquireClaim(
	{ beads, repository }: TrackerContext,
	identity: string,
	id: string,
	evidence: OperationEvidence,
): Promise<"claimed" | "closed" | "conflict"> {
	evidence.step("tracker.show", id);
	const task = await beads.show(trackerScope(repository, identity), id);
	if (task.status === "closed") {
		return "closed";
	}
	if ((task.assignee && task.assignee !== identity) || task.labels.includes("hitl")) {
		return "conflict";
	}
	try {
		evidence.step("tracker.claim", id);
		await beads.update(trackerScope(repository, identity), [id], {
			claim: true,
			ifUnchanged: task.updated_at,
			owner: task.owner,
		});
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
/** Release the stopped identity's unfinished hierarchy; execution stop is a caller precondition. */
/* eslint-disable-next-line max-statements --
 * Each conditional release retains its successful effect before inspecting the next
 * claim.
 */
export async function releaseClaims(
	{ beads, repository }: TrackerContext,
	record: RequestRecord,
	evidence: OperationEvidence,
): Promise<void> {
	const pending = new Set(record.context.claims);
	for (const id of pending) {
		evidence.step("tracker.show", id);
		// eslint-disable-next-line no-await-in-loop -- Conditional releases are serialized against real tracker versions.
		const task = await beads.show(trackerScope(repository, record.context.identity), id);
		for (const child of task.dependents) {
			if (child.dependency_type === "parent-child") {
				pending.add(child.id);
			}
		}
		if (
			task.status !== "closed" &&
			task.assignee === record.context.identity &&
			!task.labels.includes("hitl")
		) {
			let { status } = task;
			if (status === "in_progress") {
				status = "open";
			}
			evidence.step("tracker.release", id);
			/* eslint-disable-next-line no-await-in-loop --
			 * A stale version fails loudly and leaves the remaining claims intact.
			 */
			await beads.update(trackerScope(repository, "sys-colony"), [id], {
				assignee: "",
				status,
				ifUnchanged: task.updated_at,
				owner: task.owner,
			});
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
