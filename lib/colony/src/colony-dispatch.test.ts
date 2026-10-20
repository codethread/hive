/* eslint-disable import/max-dependencies -- Compose the actor, real dispatch, memory Beads and retained store. */
/* eslint-disable max-statements -- Scenarios assert current native facts across scan deadlines and publication. */
import type { RequestEvent, RequestRecord } from "./request.ts";
import { SimulatedClock, waitFor } from "xstate";
import { afterAll, expect, test } from "bun:test";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- One disposable store is prepared outside behavior timing.
import { mkdtemp, rm } from "node:fs/promises";
import type { ColonyHintEvent } from "./wake-hints.ts";
import type { Store } from "./store.ts";
import { beesConfigSchema } from "@hive/shared";
import { createColony } from "./colony.ts";
import { dispatch } from "./dispatch.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths identify private runtime state.
import { join } from "node:path";
import { openStore } from "./store.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Never open the running daemon's state.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";
import { transitionRequest } from "./request.ts";

const ONE = 1;
const FAST = 5000;
const QUIET = 60_000;
const state = await mkdtemp(join(tmpdir(), "colony-fresh-wakes-"));
const durable = openStore(state);
const records = new Map<string, Map<string, RequestRecord>>();
const store: Store = {
	...durable,
	request(root: string, id: string) {
		const record = records.get(root)?.get(id);
		if (record === undefined) {
			return;
		}
		return structuredClone(record);
	},
	requests(root: string) {
		return [...(records.get(root)?.values() ?? [])].map((record) => structuredClone(record));
	},
	saveRequest(root: string, record: RequestRecord) {
		let current = records.get(root);
		if (!current) {
			current = new Map();
			records.set(root, current);
		}
		current.set(record.id, structuredClone(record));
	},
	advanceRequest(root: string, record: RequestRecord, event: RequestEvent) {
		const next = transitionRequest(record, event);
		store.saveRequest(root, next);
		return next;
	},
};
const history: Store["history"] = {
	run: (_input, action) =>
		action({ completed: () => {}, failed: () => {}, reference: () => {}, step: () => {} }),
};
const config = beesConfigSchema.parse({ owner: "ct", humans: ["ct"], formulas: {} });
const cases = [
	{ delivered: true, delay: FAST },
	{ delivered: false, delay: QUIET },
];
const submissions = await Promise.all(cases.map(() => prepare()));
const repairs = await Promise.all(cases.map(() => prepare()));
const edits = await Promise.all(["host", "identity", "tasks"].map(() => prepare()));
const actors: ReturnType<typeof createColony>[] = [];
// Warm request/publication parsers independently of the measured wake behavior.
const warm = await prepare();
const warmId = await createSpawn(warm, warm.task);
await dispatch({ ...warm, state, store: { ...store, history } }, config, "fixture");
await warm.beads.close(trackerScope(warm.repository, "operator"), warmId);
await dispatch({ ...warm, state, store: { ...store, history } }, config, "fixture");
const submissionActors = submissions.map((tracker) => start(tracker));
const repairActors = repairs.map((tracker) => start(tracker));
const editIds = await Promise.all(edits.map((tracker) => createSpawn(tracker, tracker.task)));
const editActors = edits.map((tracker) => start(tracker));
await Promise.all(
	[...submissionActors, ...repairActors, ...editActors].map(({ actor }) => idle(actor)),
);
afterAll(async () => {
	for (const actor of actors) {
		actor.stop();
	}
	store.close();
	await rm(state, { force: true, recursive: true });
});

test.each(cases)(
	"new submission uses fresh native readiness after hint delivered=$delivered",
	async ({ delivered, delay }) => {
		const index = cases.findIndex((entry) => entry.delivered === delivered);
		const tracker = submissions[index]!;
		const current = submissionActors[index]!;
		const id = await createSpawn(tracker, tracker.task);
		if (delivered) {
			current.hint();
		}
		current.clock.increment(delay - ONE);
		expect(store.request(tracker.repository.root, id)).toBeUndefined();
		current.clock.increment(ONE);
		await idle(current.actor);
		expect(store.request(tracker.repository.root, id)?.state).toBe("waiting");
		const scope = trackerScope(tracker.repository, "operator");
		const task = await tracker.beads.show(scope, tracker.task);
		expect(task.assignee).toBeUndefined();
		await tracker.beads.close(scope, id, { reason: "cancelled" });
		current.clock.increment(FAST);
		await idle(current.actor);
		expect(store.request(tracker.repository.root, id)?.context.outcome).toBe("cancelled");
		const cancelled = await tracker.beads.show(scope, id);
		expect(cancelled.labels).toContain("bee-outcome:cancelled");
	},
);

test.each(cases)(
	"interrupted native closure labels repair after hint delivered=$delivered without a retained request",
	async ({ delivered, delay }) => {
		const index = cases.findIndex((entry) => entry.delivered === delivered);
		const tracker = repairs[index]!;
		const current = repairActors[index]!;
		const id = await createSpawn(tracker, tracker.task);
		const scope = trackerScope(tracker.repository, "operator");
		await tracker.beads.close(scope, id, { reason: "completed" });
		if (delivered) {
			current.hint();
		}
		current.clock.increment(delay);
		await idle(current.actor);
		const repaired = await tracker.beads.show(scope, id);
		expect(repaired.labels).toContain("bee-outcome:succeeded");
		expect(repaired.labels).not.toContain("bee-outcome:pending");
		expect(store.request(tracker.repository.root, id)).toBeUndefined();
	},
);

test.each(["host", "identity", "tasks"])(
	"a native %s edit after a waiting pass is checked at the next full reconciliation",
	async (field) => {
		const index = ["host", "identity", "tasks"].indexOf(field);
		const tracker = edits[index]!;
		const id = editIds[index]!;
		const current = editActors[index]!;
		const scope = trackerScope(tracker.repository, "operator");
		const spawn = await tracker.beads.show(scope, id);
		if (field === "tasks") {
			await tracker.beads.dep.add(scope, id, tracker.blocker, "related");
		} else if (field === "identity") {
			await tracker.beads.update(scope, [id], { assignee: "another-bee" });
		} else {
			await tracker.beads.update(scope, [id], {
				description: JSON.stringify({ ...JSON.parse(spawn.description), host: "another-host" }),
			});
		}
		current.hint();
		current.clock.increment(FAST);
		await waitFor(current.actor, (snapshot) => snapshot.matches("failed"));
		expect(store.request(tracker.repository.root, id)?.state).toBe("waiting");
		const task = await tracker.beads.show(scope, tracker.task);
		expect(task.assignee).toBeUndefined();
	},
);

// --- Fixtures ---
async function prepare() {
	const tracker = memoryTracker();
	tracker.repository = { ...tracker.repository, root: `/fixture/${crypto.randomUUID()}` };
	const blocker = await createTask(tracker);
	const task = await createTask(tracker, { deps: [{ id: blocker, type: "blocks" }] });
	return { ...tracker, blocker, task };
}
function start(tracker: Awaited<ReturnType<typeof prepare>>) {
	const clock = new SimulatedClock();
	let notify: (event: ColonyHintEvent) => void = () => {};
	const actor = createColony(
		{ ...tracker, state, store: { ...store, history } },
		{ state: "awake", config, revisionId: "fixture" },
		{
			clock,
			now: () => clock.now(),
			scan: dispatch,
			observeHints: (listener) => {
				notify = listener;
				return { update: () => {}, dispose: () => {} };
			},
		},
	);
	actors.push(actor);
	actor.start();
	return { actor, clock, hint: () => notify({ type: "HINT" }) };
}
function idle(actor: ReturnType<typeof createColony>) {
	return waitFor(actor, (snapshot) => snapshot.matches({ awake: "idle" }));
}
