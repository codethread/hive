import { ColonyListener } from "@hive/shared/colony-events/client";
import type { ColonyListenerOptions } from "@hive/shared/colony-events/client";

export function createListener(options: ColonyListenerOptions): ColonyListener {
	return new ColonyListener(options).on("request.settled", (event) => {
		console.log(
			JSON.stringify({
				colony: event.repository,
				request: event.request.id,
				outcome: event.request.outcome,
				attempts: event.request.attempts.length,
			}),
		);
	});
}
