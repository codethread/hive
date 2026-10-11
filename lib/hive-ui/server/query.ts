import type { BeadFilter } from "../contracts.ts";
import type { BeadSelection } from "@hive/beads";

/** Native task predicates, independent of their CLI display. */
export function taskSelection(
	filter: BeadFilter,
	ids: string[],
	page: { limit: number; offset: number },
): BeadSelection {
	return {
		...page,
		...(ids.length > 0 && { ids }),
		...(filter.statuses.length > 0 && { status: filter.statuses }),
		...(filter.priorities.length > 0 && { priority: filter.priorities }),
		...(filter.all.length > 0 && { labels: filter.all }),
		...(filter.any.length > 0 && { labelAny: filter.any }),
		excludeLabels: ["system", "bee", ...filter.exclude],
		all: filter.closed || filter.statuses.includes("closed"),
		deferred: true,
		sort: "priority",
	};
}
