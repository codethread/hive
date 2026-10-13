import {
	beforeTrackerWrite,
	createSpawn,
	createTask,
	memoryTracker,
} from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { retryRequest, spawnRequest } from "./producer.ts";
import type { ProducerCommands } from "./producer.ts";
import { RequestPublicationError } from "./requests.ts";
import { beesConfigSchema } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const config = beesConfigSchema.parse({
	owner: "ct",
	humans: ["ct"],
	kinds: {
		worker: {
			description: "Implement tasks",
			harness: "fixture",
			model: "fixture",
			effort: "low",
			system_prompt: "Worker role",
		},
	},
	formulas: { fixture: { executable: "fixture", argv: ["{{prompt}}"] } },
});
const options = { actor: "submitter", beadsDb: "/fixture/tracker.db", repo: "/fixture" };

function commands(tracker: ReturnType<typeof memoryTracker>): ProducerCommands {
	return { ...tracker, loadBeesConfig: () => Promise.resolve({ config, warnings: [] }) };
}

const admission = memoryTracker();
const task = await createTask(admission);
const reserved = await createTask(admission, { assignee: "ct" });
const retry = memoryTracker();
const unfinished = await createTask(retry);
const completed = await createTask(retry, { status: "closed" });
const predecessor = await createSpawn(retry, [unfinished, completed]);
await retry.beads.close(trackerScope(retry.repository, "worker"), predecessor, {
	reason: "exhausted",
});

test("submission rejects human reservations and admits one open request per task", async () => {
	const context = commands(admission);
	await expect(
		spawnRequest({ kind: "worker", requestedIds: [reserved], options }, context),
	).rejects.toBeInstanceOf(Error);
	const created = await spawnRequest({ kind: "worker", requestedIds: [task], options }, context);
	const request = await admission.beads.show(
		trackerScope(admission.repository, "inspector"),
		created.request.id,
	);
	expect(request.owner).toBe("ct");
	expect(request.assignee).toBe(created.request.assignee);
	expect(request.dependencies.map(({ id, dependency_type }) => ({ id, dependency_type }))).toEqual([
		{ id: task, dependency_type: "related" },
	]);
	await expect(
		spawnRequest({ kind: "worker", requestedIds: [task], options }, context),
	).rejects.toBeInstanceOf(Error);
});

/* eslint-disable-next-line max-statements --
 * Verify the retained replacement and unchanged predecessor after a partial write.
 */
test("retry retains a created replacement when predecessor label publication fails", async () => {
	const beads = beforeTrackerWrite(retry.beads, () => {
		throw new Error("publication unavailable");
	});
	const failure: unknown = await retryRequest(
		predecessor,
		options,
		commands({ ...retry, beads }),
	).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(RequestPublicationError);
	if (!(failure instanceof RequestPublicationError)) {
		throw new Error("Expected retained replacement evidence");
	}
	const [replacementId] = failure.replacementIds;
	const replacement = await retry.beads.show(
		trackerScope(retry.repository, "inspector"),
		replacementId!,
	);
	expect(
		replacement.dependencies.map(({ id, dependency_type }) => ({ id, dependency_type })),
	).toEqual([
		{ id: unfinished, dependency_type: "related" },
		{ id: predecessor, dependency_type: "supersedes" },
	]);
	expect(replacement.status).toBe("open");
	const original = await retry.beads.show(trackerScope(retry.repository, "inspector"), predecessor);
	expect(original.close_reason).toBe("exhausted");
});
