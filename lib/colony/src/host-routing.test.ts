/* eslint-disable import/max-dependencies -- Public routing uses existing dispatch, label and native fixture seams. */
import { afterAll, expect, test } from "bun:test";
import {
	beforeTrackerWrite,
	createSpawn,
	createTask,
	memoryTracker,
	unusedWorkReviewCommands,
} from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Host authority and disposable directory.
import { hostname, tmpdir } from "node:os";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare and remove the private store outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import { publishRequestLabels, reconcileClosedRequestLabels } from "./requests.ts";
import type { BeadRecord } from "@hive/beads";
import type { Store } from "./store.ts";
import { ZodError } from "zod";
import { beesConfigSchema } from "@hive/shared";
import { createAdmissionGate } from "./admission.ts";
import { dispatch } from "./dispatch.ts";
import { executionClearance } from "./execution-clearance.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Match the established request-recovery private store fixture.
import { join } from "node:path";
import { openStore } from "./store.ts";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;
const ONCE = 1;
const CLEARANCE_ADMISSION = 2;

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
const predecessorCases = [{ current: false }, { current: true }];
test.each(cases.filter(({ origin }) => origin !== "local"))(
	"#test-107 automatic $status routing excludes $origin before decoding workflow assignment",
	async (input) => {
		const fixture = await routingFixture(input);
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
	"#test-112 automatic $status routing rejects a local request missing workflow assignment",
	async (input) => {
		const fixture = await routingFixture(input);
		await expect(route(fixture)).rejects.toBeInstanceOf(ZodError);
		const after = await fixture.tracker.beads.show(
			trackerScope(fixture.tracker.repository, "fixture"),
			fixture.id,
		);
		expect(after).toEqual(fixture.before);
	},
);

test("automatic replacement publication leaves an unsupported foreign predecessor unchanged", async () => {
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
		const selected = await localPredecessorFixture(current);
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
				workflows: {
					inspect: () => Promise.reject(new Error("Host routing must precede workflow inspection")),
				},
				withAdmission: (operation) => operation(),
				workReview: unusedWorkReviewCommands(),
				workReviewClock: { nextDue: 0 },
				nurse: {
					start: () => Promise.reject(new Error("Unexpected nurse submission")),
					attach: () => Promise.reject(new Error("Unexpected nurse attachment")),
					inspect: () => Promise.reject(new Error("Unexpected nurse read")),
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

/* eslint-disable-next-line max-statements --
 * One joined race proves clearance cannot pass an in-flight dispatch reservation.
 */
test("#test-99 clearance waits for an in-flight admission and observes its reserved attempt", async () => {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: state };
	const runId = await createTask(tracker);
	const id = await createSpawn(tracker, runId);
	const claiming = Promise.withResolvers<void>();
	const proceed = Promise.withResolvers<void>();
	const queued = Promise.withResolvers<void>();
	const gate = createAdmissionGate();
	let locked = false;
	let admissions = 0;
	const withAdmission = <Result>(operation: () => Promise<Result>): Promise<Result> => {
		admissions += ONCE;
		if (admissions === CLEARANCE_ADMISSION) {
			queued.resolve();
		}
		return gate(operation);
	};
	const workflows = {
		inspect: () =>
			Promise.resolve({
				runId,
				nativeStatus: "open",
				updatedAt: "now",
				publication: {
					checkpoint: "checkpoint",
					savedAt: "now",
					locked,
					settlement: "none" as const,
				},
				lifecycle: { kind: "pending" as const },
				resolution: { kind: "unresolved" as const },
			}),
	};
	const beads = beforeTrackerWrite(tracker.beads, async (_scope, _ids, input) => {
		if (input.claim) {
			claiming.resolve();
			await proceed.promise;
		}
	});
	const policy = beesConfigSchema.parse({
		owner: "ct",
		humans: ["ct"],
		formulas: { fixture: { executable: "fixture", argv: ["{{prompt}}"] } },
	});
	const scan = dispatch(
		{
			...tracker,
			beads,
			state,
			workflows,
			withAdmission,
			workReview: unusedWorkReviewCommands(),
			workReviewClock: { nextDue: 0 },
			nurse: {
				start: () => Promise.reject(new Error("Unexpected nurse submission")),
				attach: () => Promise.reject(new Error("Unexpected nurse attachment")),
				inspect: () => Promise.reject(new Error("Unexpected nurse read")),
			},
			store: {
				...store,
				history,
				reserve: (root, receipt, record) => {
					store.reserve(root, receipt, record);
					throw new Error("Injected interruption after durable attempt reservation");
				},
			},
		},
		policy,
		"fixture",
		/* eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks --
		 * Retain background rejection while admission is held.
		 */
	).catch((error: unknown) => error);
	await claiming.promise;
	locked = true;
	let completed = false;
	const observed: string[] = [];
	const clearance = executionClearance(
		{ runId, anchorIds: [runId] },
		{
			...tracker,
			store,
			registered: true,
			withAdmission,
			workflows,
			host: hostname(),
			now: () => "now",
			observe: (receipt) => {
				observed.push(receipt.spawnId);
				return Promise.resolve({ kind: "live" });
			},
		},
		/* eslint-disable-next-line promise/prefer-await-to-then --
		 * Observe completion while independently releasing the blocked admission.
		 */
	).then((result) => {
		completed = true;
		return result;
	});
	await queued.promise;
	expect(completed).toBe(false);
	expect(observed).toEqual([]);
	proceed.resolve();
	expect(await scan).toBeInstanceOf(Error);
	const observation = await clearance;
	expect(observation.result).toMatchObject({
		kind: "refused",
		blockers: [{ reason: "live_execution", requestId: id }],
	});
	expect(observed).toEqual([id]);
	expect(store.requests(state)[FIRST]).toMatchObject({
		state: "executing",
		context: { attempts: ONCE },
	});
});

async function localPredecessorFixture(current: boolean) {
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
	return { fixture, replacement: id };
}
