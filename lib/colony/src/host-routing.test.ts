/* eslint-disable import/max-dependencies -- Public routing uses existing dispatch, label and native fixture seams. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { BeadRecord } from "@hive/beads";
import { ZodError } from "zod";
// eslint-disable-next-line import/no-nodejs-modules -- Host authority and disposable directory.
import { hostname } from "node:os";
import { publishRequestLabels } from "./requests.ts";
import { trackerScope } from "./tracker.ts";

interface RoutingCase {
	/** Native lifecycle path exercised by automatic routing. */
	status: "open" | "closed";
	/** Fixture lookup key and readable origin. */
	origin: string;
	/** Native provenance; absent host is unbound. */
	host: string | undefined;
}
interface Fixture extends RoutingCase {
	/** Isolated memory Beads endpoint. */
	tracker: ReturnType<typeof memoryTracker>;
	/** Work that must not be claimed on an excluded request. */
	task: string;
	/** Spawn with deliberately absent execution assignment. */
	id: string;
	/** Full native record retained to detect unintended mutations. */
	before: BeadRecord;
}

const predecessor = await routingFixture({
	status: "closed",
	origin: "replacement",
	host: "foreign-host",
});
const replacement = await createSpawn(predecessor.tracker, predecessor.task, {
	deps: [
		{ id: predecessor.task, type: "related" },
		{ id: predecessor.id, type: "supersedes" },
	],
});
predecessor.before = await predecessor.tracker.beads.show(
	trackerScope(predecessor.tracker.repository, "fixture"),
	predecessor.id,
);

const predecessorCases = [{ current: false }, { current: true }];
const localPredecessors = await Promise.all(
	predecessorCases.map(async ({ current }) => {
		const fixture = await routingFixture({
			status: "closed",
			origin: String(current),
			host: hostname(),
		});
		if (current) {
			await fixture.tracker.beads.update(
				trackerScope(fixture.tracker.repository, "fixture"),
				[fixture.id],
				{
					setLabels: [
						"system",
						"bee",
						"agent:worker",
						"bee-outcome:succeeded",
						"bee-resolution:resolved",
					],
				},
			);
		}
		const id = await createSpawn(fixture.tracker, fixture.task, {
			deps: [
				{ id: fixture.task, type: "related" },
				{ id: fixture.id, type: "supersedes" },
			],
		});
		fixture.before = await fixture.tracker.beads.show(
			trackerScope(fixture.tracker.repository, "fixture"),
			fixture.id,
		);
		return { current, fixture, replacement: id };
	}),
);

test("automatic replacement publication leaves an unsupported foreign predecessor unchanged #test-636", async () => {
	await publishRequestLabels(predecessor.tracker, "colony", replacement, hostname());
	const after = await predecessor.tracker.beads.show(
		trackerScope(predecessor.tracker.repository, "fixture"),
		predecessor.id,
	);
	expect(after).toEqual(predecessor.before);
});

test.each(predecessorCases)(
	"local predecessor with current labels $current is validated before publication #test-637",
	async ({ current }) => {
		const selected = localPredecessors.find((fixture) => fixture.current === current)!;
		await expect(
			publishRequestLabels(selected.fixture.tracker, "colony", selected.replacement, hostname()),
		).rejects.toBeInstanceOf(ZodError);
		const after = await selected.fixture.tracker.beads.show(
			trackerScope(selected.fixture.tracker.repository, "fixture"),
			selected.fixture.id,
		);
		expect(after).toEqual(selected.fixture.before);
	},
);

async function routingFixture(input: RoutingCase): Promise<Fixture> {
	const tracker = memoryTracker();
	const task = await createTask(tracker);
	const id = await createSpawn(tracker, task);
	const initial = await tracker.beads.show(trackerScope(tracker.repository, "fixture"), id);
	const { assignment: _assignment, ...payload } = JSON.parse(initial.description);
	await tracker.beads.update(trackerScope(tracker.repository, "fixture"), [id], {
		description: JSON.stringify({ ...payload, host: input.host }),
	});
	if (input.status === "closed") {
		await tracker.beads.close(trackerScope(tracker.repository, "fixture"), id, {
			reason: "completed",
		});
	}
	const before = await tracker.beads.show(trackerScope(tracker.repository, "fixture"), id);
	return { ...input, tracker, task, id, before };
}
