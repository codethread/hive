import type { AlertStore, TrackerAlertObservation } from "./alerts.ts";
import { BeeswaxError, errorMessage } from "../errors.ts";
import { z } from "zod";

const NONEMPTY = 1;
export const trackerRecoverySchema = z.strictObject({
	id: z.string().trim().min(NONEMPTY),
	writersPaused: z.literal(true),
	evidence: z.string().trim().min(NONEMPTY),
});
export type TrackerRecovery = z.infer<typeof trackerRecoverySchema>;

export interface AlertPublicationServices {
	/** Independent receipt boundary. */
	alerts: AlertStore;
	/** Existing tracker publication lock; does not claim to quiesce routine writers. */
	withPublicationLock: (action: () => Promise<void>) => Promise<void>;
	/** Complete native reconciliation/export and Git publication, failing loudly. */
	publish: () => Promise<void>;
}

/** Admission and exact-incident clearance surround the complete publication operation. */
export async function publishWithAlert(
	database: string,
	services: AlertPublicationServices,
	recovery?: TrackerRecovery,
): Promise<void> {
	assertAdmission(await services.alerts.observe(database), recovery);
	let acquired = false;
	try {
		await services.withPublicationLock(async () => {
			acquired = true;
			// A preceding publisher may have failed while this invocation waited for its lock.
			assertAdmission(await services.alerts.observe(database), recovery);
			try {
				await services.publish();
			} catch (error) {
				await recordFailure(database, services.alerts, error);
			}
			if (recovery) {
				await services.alerts
					.clear(database, recovery.id, recovery.evidence)
					.catch((error: unknown) => {
						let reason = "tracker_alert_unavailable";
						if (error instanceof BeeswaxError) {
							({ reason } = error);
						}
						throw new BeeswaxError(
							reason,
							`Publication succeeded; clearance is unverified: ${errorMessage(error)}`,
							{
								context: {
									...publicationContext(error),
									database,
									incident: recovery.id,
									publication: "succeeded",
									clearance: "unverified",
								},
							},
						);
					});
			}
		});
	} catch (error) {
		if (acquired) {
			throw error;
		}
		await recordFailure(database, services.alerts, error);
	}
}

// --- Private functions ---

function assertAdmission(
	observation: TrackerAlertObservation,
	recovery: TrackerRecovery | undefined,
): void {
	const { database, alert } = observation;
	if (recovery) {
		if (alert?.state !== "active" || alert.id !== recovery.id) {
			throw new BeeswaxError(
				"tracker_alert_changed",
				"Recovery requires the exact current active incident.",
				{
					context: { database, incident: recovery.id, alert },
				},
			);
		}
		return;
	}
	if (alert?.state === "active") {
		throw new BeeswaxError(
			"tracker_held",
			"Tracker publication is held; run beeswax beads recover for the handoff.",
			{
				context: { database, alert },
			},
		);
	}
}

function publicationContext(error: unknown): Record<string, unknown> {
	if (error instanceof BeeswaxError) {
		return error.context;
	}
	return {};
}

async function recordFailure(database: string, alerts: AlertStore, error: unknown): Promise<never> {
	const alert = await alerts
		.activate(database, `Publication failed: ${errorMessage(error)}`)
		.catch((stateError: unknown) => {
			throw new BeeswaxError(
				"tracker_sync_alert_failed",
				`Publication failed: ${errorMessage(error)}; alert persistence failed: ${errorMessage(stateError)}`,
				{
					context: {
						...publicationContext(error),
						database,
						publicationError: errorMessage(error),
						alertError: errorMessage(stateError),
					},
				},
			);
		});
	throw new BeeswaxError("tracker_sync_failed", errorMessage(error), {
		context: { ...publicationContext(error), database, alert: alert.alert },
	});
}
