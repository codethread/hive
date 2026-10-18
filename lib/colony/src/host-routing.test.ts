/* eslint-disable import/max-dependencies -- Public routing uses existing dispatch, label and native fixture seams. */
import { afterAll, expect, test } from "bun:test";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Host authority and disposable directory.
import { hostname, tmpdir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and remove the private store outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import { publishRequestLabels, reconcileClosedRequestLabels } from "./requests.ts";
import type { BeadRecord } from "@hive/beads";
import type { Store } from "./store.ts";
import { ZodError } from "zod";
import { beesConfigSchema } from "@hive/shared";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Match the established request-recovery private store fixture.
import { join } from "node:path";
import { openStore } from "./store.ts";
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

const state = await mkdtemp(join(tmpdir(), "colony-host-routing-"));
const store = openStore(state);
const config = beesConfigSchema.parse({ formulas: {}, humans: ["ct"], owner: "ct" });
// Match request-recovery's no-op evidence; Beads/store operations remain actual fixture adapters.
const history: Store["history"] = {
	run: (_input, action) =>
		action({ completed: () => {}, failed: () => {}, reference: () => {}, step: () => {} }),
};
const origins = [
	{ origin: "foreign", host: "foreign-host" },
	{ origin: "unbound", host: undefined },
	{ origin: "local", host: hostname() },
];
const cases: RoutingCase[] = (["open", "closed"] as const).flatMap((status) =>
	origins.map(({ origin, host }) => ({ status, origin, host })),
);
const prepared = await Promise.all(cases.map((input) => routingFixture(input)));
const fixtures = new Map(
	prepared.map((fixture) => [`${fixture.status}:${fixture.origin}`, fixture]),
);
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

test.each(cases.filter(({ origin }) => origin !== "local"))(
	"automatic $status routing excludes $origin before decoding workflow assignment",
	async ({ status, origin }) => {
		const fixture = fixtures.get(`${status}:${origin}`)!;
		await route(fixture);
		const after = await fixture.tracker.beads.show(
			trackerScope(fixture.tracker.repository, "fixture"),
			fixture.id,
		);
		const task = await fixture.tracker.beads.show(
			trackerScope(fixture.tracker.repository, "fixture"),
			fixture.task,
		);
		expect(after).toEqual(fixture.before);
		expect(task.assignee).toBeUndefined();
		expect(store.requests(fixture.tracker.repository.root)).toEqual([]);
	},
);

test.each(cases.filter(({ origin }) => origin === "local"))(
	"automatic $status routing rejects a local request missing workflow assignment",
	async ({ status, origin }) => {
		const fixture = fixtures.get(`${status}:${origin}`)!;
		await expect(route(fixture)).rejects.toBeInstanceOf(ZodError);
		const after = await fixture.tracker.beads.show(
			trackerScope(fixture.tracker.repository, "fixture"),
			fixture.id,
		);
		expect(after).toEqual(fixture.before);
	},
);

test("automatic replacement publication leaves an unsupported foreign predecessor unchanged", async () => {
	await publishRequestLabels(predecessor.tracker, "colony", replacement, hostname());
	const after = await predecessor.tracker.beads.show(
		trackerScope(predecessor.tracker.repository, "fixture"),
		predecessor.id,
	);
	expect(after).toEqual(predecessor.before);
});

test.each(predecessorCases)(
	"local predecessor with current labels $current is validated before publication",
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

afterAll(async () => {
	store.close();
	await rm(state, { recursive: true, force: true });
});

function route(fixture: Fixture): Promise<void> {
	if (fixture.status === "open") {
		return dispatch(
			{
				...fixture.tracker,
				state,
				store: { ...store, history },
				nurse: {
					start: () => Promise.reject(new Error("Unexpected nurse submission")),
					attach: () => Promise.reject(new Error("Unexpected nurse attachment")),
					show: () => Promise.reject(new Error("Unexpected nurse read")),
				},
			},
			config,
			"fixture",
		);
	}
	return reconcileClosedRequestLabels(fixture.tracker);
}

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
