import { acquireClaim, releaseClaims } from "./claims.ts";
import {
	beforeTrackerWrite,
	createSpawn,
	createTask,
	memoryTracker,
} from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import type { OperationEvidence } from "./history.ts";
import { newRequest } from "./request.ts";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;
// Seed the isolated release fixture outside behavior timing, following config.test.ts.
const releaseFixture = await claimFixture();
const hierarchyFixture = await hierarchyClaimFixture();

async function claimFixture() {
	const tracker = memoryTracker();
	const id = await createTask(tracker);
	const foreign = await createTask(tracker, { assignee: "another-bee", status: "in_progress" });
	const closed = await createTask(tracker, { status: "closed" });
	const spawn = await createSpawn(tracker, [id, foreign, closed]);
	const request = newRequest(
		await tracker.beads.show(trackerScope(tracker.repository, "worker"), spawn),
		tracker.repository,
	);
	return { tracker, id, foreign, closed, request };
}

// eslint-disable-next-line max-statements -- Seed one isolated hierarchy before measuring release behavior.
async function hierarchyClaimFixture() {
	const tracker = memoryTracker();
	const root = await createTask(tracker, { assignee: "worker", status: "in_progress" });
	const foreign = await createTask(tracker, {
		parent: root,
		assignee: "another-bee",
		status: "in_progress",
	});
	const descendant = await createTask(tracker, {
		parent: foreign,
		assignee: "worker",
		status: "blocked",
	});
	const reserved = await createTask(tracker, {
		parent: root,
		assignee: "worker",
		status: "in_progress",
		labels: ["hitl"],
	});
	const closed = await createTask(tracker, {
		parent: root,
		assignee: "worker",
		status: "closed",
	});
	const unrelated = await createTask(tracker, {
		assignee: "worker",
		status: "in_progress",
		deps: [{ id: root, type: "related" }],
	});
	const scope = trackerScope(tracker.repository, "inspector");
	const untouched = [foreign, reserved, closed, unrelated];
	const before = await tracker.beads.showMany(scope, untouched);
	const spawn = await createSpawn(tracker, [root]);
	const request = newRequest(await tracker.beads.show(scope, spawn), tracker.repository);
	return { tracker, root, descendant, untouched, before, scope, request };
}

function operationEvidence(): OperationEvidence & { failures: unknown[]; effects: string[] } {
	const failures: unknown[] = [];
	const effects: string[] = [];
	return {
		completed: (operation, id) => {
			effects.push(`${operation}:${id}`);
		},
		effects,
		failed: (error) => {
			failures.push(error);
		},
		failures,
		reference: () => {},
		step: () => {},
	};
}

/* eslint-disable-next-line max-statements --
 * One release verifies owned, foreign and closed claims against the same request.
 */
test("claims preserve human ownership and release only unfinished tasks still owned by this bee", async () => {
	const { tracker, id, foreign, closed, request } = releaseFixture;
	const evidence = operationEvidence();
	expect(await acquireClaim(tracker, "worker", id, evidence)).toBe("claimed");
	expect(await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id)).toMatchObject(
		{
			assignee: "worker",
			owner: "ct",
			status: "in_progress",
		},
	);
	await releaseClaims(
		tracker,
		{ ...request, context: { ...request.context, claims: [id, foreign, closed] } },
		evidence,
	);
	const released = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id);
	expect(released.assignee).toBeUndefined();
	expect(released).toMatchObject({ owner: "ct", status: "open" });
	expect(
		await tracker.beads.show(trackerScope(tracker.repository, "inspector"), foreign),
	).toMatchObject({
		assignee: "another-bee",
		status: "in_progress",
	});
	const untouched = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), closed);
	expect(untouched.status).toBe("closed");
	expect(evidence.effects).toEqual([`tracker.claimed:${id}`, `tracker.released:${id}`]);
});

test("stopped root releases owned descendants while preserving protected and related work", async () => {
	const { tracker, root, descendant, untouched, before, scope, request } = hierarchyFixture;
	const evidence = operationEvidence();
	await releaseClaims(
		tracker,
		{ ...request, context: { ...request.context, claims: [root] } },
		evidence,
	);
	const released = await tracker.beads.showMany(scope, [root, descendant]);
	expect(released.map(({ owner, status, assignee }) => ({ owner, status, assignee }))).toEqual([
		{ owner: "ct", status: "open", assignee: undefined },
		{ owner: "ct", status: "blocked", assignee: undefined },
	]);
	const preserved = await tracker.beads.showMany(scope, untouched);
	expect(preserved.map(({ updated_at }) => updated_at)).toEqual(
		before.map(({ updated_at }) => updated_at),
	);
	expect(evidence.effects).toEqual([`tracker.released:${root}`, `tracker.released:${descendant}`]);
});

test.each([
	{ input: { assignee: "ct" }, outcome: "conflict" },
	{ input: { labels: ["hitl"] }, outcome: "conflict" },
	{ input: { status: "closed" }, outcome: "closed" },
])(
	"claim leaves reserved or closed tasks unchanged: $outcome $input",
	async ({ input, outcome }) => {
		const tracker = memoryTracker();
		const reserved = await createTask(tracker, input);
		const before = await tracker.beads.show(
			trackerScope(tracker.repository, "inspector"),
			reserved,
		);
		expect(await acquireClaim(tracker, "worker", reserved, operationEvidence())).toBe(outcome);
		expect(
			await tracker.beads.show(trackerScope(tracker.repository, "inspector"), reserved),
		).toEqual(before);
	},
);

test("a reservation changed after inspection produces a claim conflict with retained evidence", async () => {
	const tracker = memoryTracker();
	const id = await createTask(tracker);
	const beads = beforeTrackerWrite(tracker.beads, async (scope) => {
		expect(scope).toEqual({
			cwd: tracker.repository.root,
			db: tracker.repository.beadsDb,
			actor: "worker",
		});
		await tracker.beads.update(trackerScope(tracker.repository, "another-bee"), [id], {
			claim: true,
		});
	});
	const evidence = operationEvidence();
	expect(await acquireClaim({ ...tracker, beads }, "worker", id, evidence)).toBe("conflict");
	expect(await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id)).toMatchObject(
		{
			assignee: "another-bee",
			owner: "ct",
		},
	);
	expect(evidence.failures[FIRST]).toBeInstanceOf(CommandError);
	expect(evidence.effects).toEqual([]);
});
