/* eslint-disable unicorn/no-null -- Tests distinguish no output from observed stdout. */
import { afterAll, expect, mock, test } from "bun:test";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Prepare deterministic stdout metadata outside behavior timing.
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { publishObservation, publishStdoutActivity, stdoutActivityDue } from "./observations.ts";
import type { Bead } from "@hive/beads";
// eslint-disable-next-line import/no-nodejs-modules -- Match the established disposable artifact fixture pattern.
import { join } from "node:path";
import { latestStdoutActivity } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Keep stdout artifacts separate from live attempt logs.
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

const observationTracker = memoryTracker();
const observationId = await createSpawn(observationTracker, await createTask(observationTracker));
await observationTracker.beads.show(
	trackerScope(observationTracker.repository, "inspector"),
	observationId,
);

const stdoutDirectory = await mkdtemp(join(tmpdir(), "colony-observations-"));
const stdoutTimestamp = "2026-10-04T10:00:00.000Z";
const stdoutPath = join(stdoutDirectory, "stdout.log");
await writeFile(stdoutPath, "Worker output\n");
await utimes(stdoutPath, new Date(stdoutTimestamp), new Date(stdoutTimestamp));
afterAll(() => rm(stdoutDirectory, { force: true, recursive: true }));

const unchangedFixtures = new Map(
	await Promise.all(
		(["fact", "stdout"] as const).map(async (kind) => {
			const fixture = await publicationFixture(kind);
			await fixture.publish();
			const snapshot = await fixture.tracker.beads.show(fixture.scope, fixture.id);
			fixture.show.mockClear();
			return [kind, { ...fixture, snapshot }] as const;
		}),
	),
);

const dueFixtures = new Map(
	await Promise.all(
		(["fact", "stdout"] as const).map(
			async (kind) => [kind, await publicationFixture(kind)] as const,
		),
	),
);
const driftCases = [
	{ kind: "fact", drift: "host" },
	{ kind: "stdout", drift: "host" },
	{ kind: "fact", drift: "closed" },
	{ kind: "stdout", drift: "closed" },
	{ kind: "fact", drift: "duplicate" },
	{ kind: "stdout", drift: "duplicate" },
] as const;
const driftFixtures = new Map(
	await Promise.all(
		driftCases.map(
			async (input) => [`${input.kind}:${input.drift}`, await driftFixture(input)] as const,
		),
	),
);

const previous = {
	attemptId: "attempt-one",
	attemptNumber: 1,
	lastOutputAt: "2026-10-04T10:00:00.123Z",
	recordedAt: "2026-10-04T10:00:01.000Z",
};

test.each([
	{ due: false, final: false, recordedAt: "2026-10-04T10:00:30.999Z" },
	{ due: true, final: false, recordedAt: "2026-10-04T10:00:31.000Z" },
	{ due: true, final: true, recordedAt: "2026-10-04T10:00:02.000Z" },
])("changed stdout publication at $recordedAt, final=$final", ({ due, final, recordedAt }) => {
	expect(
		stdoutActivityDue(
			previous,
			{ ...previous, lastOutputAt: "2026-10-04T10:00:01.500Z", recordedAt },
			final,
		),
	).toBe(due);
});

test("silence never refreshes an existing activity timestamp, including settlement", () => {
	const later = { ...previous, recordedAt: "2026-10-04T12:00:00.000Z" };
	expect(stdoutActivityDue(previous, later)).toBe(false);
	expect(stdoutActivityDue(previous, later, true)).toBe(false);
	expect(
		stdoutActivityDue({ ...previous, lastOutputAt: null }, { ...later, lastOutputAt: null }),
	).toBe(false);
});

test("new attempts replace old activity with unknown and first actual output publishes immediately", () => {
	const fresh = { ...previous, attemptId: "attempt-two", attemptNumber: 2, lastOutputAt: null };
	expect(stdoutActivityDue(undefined, fresh)).toBe(true);
	expect(stdoutActivityDue(previous, fresh)).toBe(true);
	expect(stdoutActivityDue(fresh, { ...fresh, lastOutputAt: previous.lastOutputAt })).toBe(true);
});

test("injected observations deduplicate unchanged facts and retain their native attribution #test-591", async () => {
	const tracker = observationTracker;
	const id = observationId;
	await publishObservation(tracker, id, "waiting: dependency");
	await publishObservation(tracker, id, "waiting: dependency");
	await publishObservation(tracker, id, "waiting: capacity");
	const request = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id);
	expect(request.comments.map(({ author, text }) => ({ author, text }))).toEqual([
		{ author: "sys-colony", text: "Colony observation: waiting: dependency" },
		{ author: "sys-colony", text: "Colony observation: waiting: capacity" },
	]);
});

test.each(["fact", "stdout"] as const)(
	"unchanged %s uses zero snapshot reads but standalone publication still reads once",
	async (kind) => {
		const fixture = unchangedFixtures.get(kind)!;
		const { snapshot } = fixture;
		const standaloneShow = mock(fixture.tracker.beads.show);
		// Both paths are unchanged; parallel metadata reads avoid serial filesystem scheduling overhead.
		await Promise.all([
			fixture.publish(snapshot),
			fixture.publish(undefined, { ...fixture.tracker.beads, show: standaloneShow }),
		]);
		expect(fixture.show).not.toHaveBeenCalled();
		expect(standaloneShow.mock.calls.map(([scope, id]) => ({ actor: scope.actor, id }))).toEqual([
			{ actor: "sys-colony", id: fixture.id },
		]);
		expect(await fixture.tracker.beads.show(fixture.scope, fixture.id)).toEqual(snapshot);
	},
);

test.each(["fact", "stdout"] as const)(
	"due %s refreshes once and retains native publication attribution",
	async (kind) => {
		const fixture = dueFixtures.get(kind)!;
		const snapshot = await fixture.tracker.beads.show(fixture.scope, fixture.id);
		await fixture.publish(snapshot);
		expect(fixture.show.mock.calls.map(([scope, id]) => ({ actor: scope.actor, id }))).toEqual([
			{ actor: "sys-colony", id: fixture.id },
		]);
		const result = await fixture.tracker.beads.show(fixture.scope, fixture.id);
		expect(result.comments.map(({ author }) => author)).toEqual(["sys-colony"]);
		if (kind === "stdout") {
			expect(latestStdoutActivity(result)).toMatchObject({
				attemptId: fixture.receipt.id,
				attemptNumber: fixture.receipt.attemptNumber,
				lastOutputAt: stdoutTimestamp,
			});
		} else {
			expect(result.comments.map(({ text }) => text)).toEqual([
				"Colony observation: waiting: dependency",
			]);
		}
	},
);

test.each([...driftCases])(
	"due $kind publication rechecks native $drift drift after its phase snapshot",
	async ({ kind, drift }) => {
		const { tracker, scope, id, show, publish, snapshot, before } = driftFixtures.get(
			`${kind}:${drift}`,
		)!;
		// eslint-disable-next-line unicorn/prefer-ternary -- Distinguish rejection assertions without a forbidden ternary.
		if (drift === "host") {
			await expect(publish(snapshot)).rejects.toBeInstanceOf(Error);
		} else {
			await publish(snapshot);
		}
		expect(show.mock.calls.map(([, target]) => target)).toEqual([id]);
		expect(await tracker.beads.show(scope, id)).toEqual(before);
	},
);

test("final stdout flush still publishes for a freshly closed request", async () => {
	const fixture = await publicationFixture("stdout");
	const snapshot = await fixture.tracker.beads.show(fixture.scope, fixture.id);
	await fixture.tracker.beads.close(fixture.scope, fixture.id, { reason: "completed" });
	await publishStdoutActivity(fixture.context, fixture.receipt, true, snapshot);
	expect(fixture.show.mock.calls.map(([, id]) => id)).toEqual([fixture.id]);
	const result = await fixture.tracker.beads.show(fixture.scope, fixture.id);
	expect(result.status).toBe("closed");
	expect(result.comments.map(({ author }) => author)).toEqual(["sys-colony"]);
	expect(latestStdoutActivity(result)).toMatchObject({ lastOutputAt: stdoutTimestamp });
});

// --- Fixtures ---
async function driftFixture({ kind, drift }: (typeof driftCases)[number]) {
	const fixture = await publicationFixture(kind);
	const { tracker, scope, id, publish, show } = fixture;
	const snapshot = await tracker.beads.show(scope, id);
	if (drift === "host") {
		await tracker.beads.update(scope, [id], {
			description: JSON.stringify({ ...JSON.parse(snapshot.description), host: "another-host" }),
		});
	} else if (drift === "closed") {
		await tracker.beads.close(scope, id, { reason: "Stopped by Bee" });
	} else {
		await publish();
	}
	const before = await tracker.beads.show(scope, id);
	show.mockClear();
	return { ...fixture, snapshot, before };
}

async function publicationFixture(kind: "fact" | "stdout") {
	const tracker = memoryTracker();
	const id = await createSpawn(tracker, await createTask(tracker));
	const scope = trackerScope(tracker.repository, "inspector");
	const show = mock(tracker.beads.show);
	const context = { ...tracker, beads: { ...tracker.beads, show } };
	const receipt = { id: "attempt-one", attemptNumber: 1, spawnId: id, directory: stdoutDirectory };
	const publish = (snapshot?: Bead, beads = context.beads) => {
		const input = { ...tracker, beads };
		if (kind === "fact") {
			return publishObservation(input, id, "waiting: dependency", snapshot);
		}
		return publishStdoutActivity(input, receipt, false, snapshot);
	};
	return { tracker, id, scope, show, context, receipt, publish };
}
