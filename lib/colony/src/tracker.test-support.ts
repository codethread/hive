/* eslint-disable unicorn/no-null -- Captured recipes explicitly select the canonical cwd with null. */
import type { BeadsService, CreateBead } from "@hive/beads";
import type { TrackerCommands, TrackerContext } from "./tracker.ts";
import { createMemoryBeads } from "@hive/beads";
/* eslint-disable-next-line import/no-nodejs-modules --
 * Fixtures bind requests to the same host as production authority checks.
 */
import { hostname } from "node:os";
import { spawnRequestLabels } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

/** Pure tracker fixture: its paths identify isolated memory stores, never native files. */
export function memoryTracker(): TrackerContext & TrackerCommands {
	const repository = { beadsDb: "/fixture/tracker.db", root: "/fixture" };
	return {
		beads: createMemoryBeads(),
		repository,
		resolveRepository: () => Promise.resolve(repository),
	};
}

export async function createTask(
	{ beads, repository }: TrackerContext,
	input: Partial<CreateBead> = {},
): Promise<string> {
	const created = await beads.create(trackerScope(repository, "submitter"), {
		title: "Assigned task",
		owner: "ct",
		...input,
	});
	return created.id;
}

export function createSpawn(
	context: TrackerContext,
	runId: string,
	input: Partial<CreateBead> = {},
): Promise<string> {
	return createTask(context, {
		assignee: "worker",
		labels: spawnRequestLabels("worker"),
		description: JSON.stringify({
			assignment: { kind: "driver", runId },
			cwd: null,
			effort: "low",
			harness: "fixture",
			host: hostname(),
			kind: "worker",
			model: "fixture",
			prompt: "Complete assigned tasks",
			system_prompt: "Worker role",
		}),
		deps: [{ id: runId, type: "related" }],
		...input,
	});
}

/** Run an actual memory mutation immediately before a consumer's conditional update. */
export function beforeTrackerWrite(
	beads: BeadsService,
	before: (...args: Parameters<BeadsService["update"]>) => Promise<void>,
): BeadsService {
	return {
		...beads,
		update: async (scope, ids, input) => {
			await before(scope, ids, input);
			return beads.update(scope, ids, input);
		},
	};
}
