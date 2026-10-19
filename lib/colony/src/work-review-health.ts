import { WorkReviewError } from "./work-review.ts";

interface RecoveryEffects {
	requestId: string;
	taskId: string;
	reopenedIds: string[];
	replacementIds: string[];
	phase: string;
}

export class WorkReviewHealthError extends WorkReviewError {
	/** Confirmed effects from the paused operation, without further tracker reads. */
	readonly requestId: string;
	readonly taskId: string;
	readonly reopenedIds: string[];
	readonly replacementIds: string[];
	readonly phase: string;
	readonly nextAction = [
		"Follow the tracker-alert recovery protocol, then inspect retained control",
		"and confirmed effects before continuing.",
	].join(" ");
	constructor(recovery: RecoveryEffects, cause: unknown) {
		super(
			"tracker_unavailable",
			`Recovery paused without further tracker effects: ${String(cause)}`,
		);
		this.name = "WorkReviewHealthError";
		this.cause = cause;
		this.requestId = recovery.requestId;
		this.taskId = recovery.taskId;
		this.reopenedIds = [...recovery.reopenedIds];
		this.replacementIds = [...recovery.replacementIds];
		this.phase = recovery.phase;
	}
}
