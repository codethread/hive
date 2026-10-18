/* eslint-disable unicorn/no-null -- Inspection JSON explicitly encodes absent assignees. */
import {
	RequestPublicationError,
	acknowledgeRequest,
	inspectRequest,
	publishRequestLabels,
	stopRequest,
} from "./requests.ts";
import {
	beforeTrackerWrite,
	createSpawn,
	createTask,
	memoryTracker,
} from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import { acknowledgmentSchema } from "@hive/shared";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;
const ONE = 1;
const TWO = 2;

const options = { actor: "operator", beadsDb: "/fixture/tracker.db", repo: "/fixture" };
// Fixture creation and initial schema compilation are independent of the behavior under test.
const inspection = await requestFixture();
const cancellation = await requestFixture();
const acknowledgment = await requestFixture();
const conflict = await requestFixture();
const supersession = memoryTracker();
const supersessionTask = await createTask(supersession);
const waiting = await inspectRequest(inspection.id, options, inspection.tracker);
await acknowledgment.tracker.beads.close(
	trackerScope(acknowledgment.tracker.repository, "worker"),
	acknowledgment.id,
	{ reason: "blocked" },
);
const failedRequest = await acknowledgment.tracker.beads.show(
	trackerScope(acknowledgment.tracker.repository, "inspector"),
	acknowledgment.id,
);
const acceptance = acknowledgmentSchema.parse({
	closedAt: failedRequest.closed_at,
	reason: "Accepted separately",
});

async function requestFixture() {
	const tracker = memoryTracker();
	const dependency = await createTask(tracker);
	const task = await createTask(tracker, { deps: [{ id: dependency, type: "blocks" }] });
	const id = await createSpawn(tracker, task);
	return { tracker, dependency, task, id };
}

test("offline inspection derives dependency readiness from the injected tracker", async () => {
	const { tracker, dependency, task, id } = inspection;
	expect(waiting.request.tasks).toEqual([
		{ assignee: null, id: task, readiness: "blocked", status: "open" },
	]);
	await tracker.beads.close(trackerScope(tracker.repository, "worker"), dependency, {
		reason: "Completed",
	});
	const ready = await inspectRequest(id, options, tracker);
	expect(ready.request.tasks[FIRST]?.readiness).toBe("ready");
	expect(ready.request.disposition).toEqual({ outcome: "pending", resolution: "unresolved" });
});

test("stop publishes cancellation with current request labels", async () => {
	const { tracker, task, id } = cancellation;
	const result = await stopRequest(id, options, tracker);
	expect(result.request.disposition).toEqual({ outcome: "cancelled", resolution: "resolved" });
	expect(result.request.labelPublication).toBe("current");
	expect(result.request.tasks).toContainEqual({
		assignee: null,
		id: task,
		readiness: "blocked",
		status: "open",
	});
});

/* eslint-disable-next-line max-statements --
 * Partial publication, repair and idempotence form one offline acknowledgment contract.
 */
test("acknowledgment survives failed label publication and repeats repair without another comment", async () => {
	const { tracker, id } = acknowledgment;
	const beads = beforeTrackerWrite(tracker.beads, () => {
		throw new CommandError("br update", { code: 1, stderr: "fixture write failure", stdout: "" });
	});
	await expect(
		acknowledgeRequest(id, { ...options, reason: acceptance.reason }, { ...tracker, beads }),
	).rejects.toBeInstanceOf(RequestPublicationError);
	const retained = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id);
	expect(retained.comments).toHaveLength(ONE);
	expect(retained.comments[FIRST]?.author).toBe("operator");
	const result = await acknowledgeRequest(
		id,
		{ ...options, actor: "later-operator", reason: "Later reason" },
		tracker,
	);
	expect(result.request.acknowledgment).toMatchObject({
		actor: "operator",
		reason: "Accepted separately",
	});
	expect(result.request.disposition).toEqual({ outcome: "failed", resolution: "resolved" });
	expect(result.request.labelPublication).toBe("current");
	const repaired = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id);
	expect(repaired.comments).toHaveLength(ONE);
	expect(repaired.close_reason).toBe("blocked");
});

test("publication rebases a revision conflict while retaining unrelated labels", async () => {
	const { tracker, id } = conflict;
	await tracker.beads.close(trackerScope(tracker.repository, "worker"), id, {
		reason: "completed",
	});
	let writes = 0;
	const beads = beforeTrackerWrite(tracker.beads, async () => {
		writes += ONE;
		if (writes === ONE) {
			await tracker.beads.update(trackerScope(tracker.repository, "another-actor"), [id], {
				addLabels: ["extra"],
			});
		}
	});
	const published = await publishRequestLabels({ ...tracker, beads }, "worker", id);
	expect(published.labels).toContain("extra");
	expect(published.labels).toContain("bee-outcome:succeeded");
	expect(published.labels).toContain("bee-resolution:resolved");
	expect(writes).toBe(TWO);
});

test("publication repairs superseded predecessors from native relationship facts", async () => {
	const tracker = supersession;
	const predecessor = await createSpawn(tracker, supersessionTask);
	await tracker.beads.close(trackerScope(tracker.repository, "worker"), predecessor, {
		reason: "exhausted",
	});
	const replacement = await createSpawn(tracker, supersessionTask, {
		deps: [
			{ id: supersessionTask, type: "related" },
			{ id: predecessor, type: "supersedes" },
		],
	});
	await publishRequestLabels(tracker, "worker", replacement);
	const old = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), predecessor);
	expect(old.close_reason).toBe("exhausted");
	expect(old.labels).toContain("bee-outcome:failed");
	expect(old.labels).toContain("bee-resolution:resolved");
});
