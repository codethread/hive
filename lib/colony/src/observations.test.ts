/* eslint-disable max-statements -- Keep mutation, failure and partial-publication re-entry traces together. */
/* eslint-disable unicorn/no-null -- Tests distinguish no output from observed stdout. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, mock, test } from "bun:test";
import {
	publishObservation,
	publishRunningObservations,
	publishStdoutActivity,
	stdoutActivityDue,
} from "./observations.ts";
import type { Bead } from "@hive/beads";
import { COLONY_STDOUT_PREFIX } from "@hive/shared";
import type { readStdoutActivity } from "./observations.ts";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const observationTracker = memoryTracker();
const observationId = await createSpawn(observationTracker, await createTask(observationTracker));
await observationTracker.beads.show(
	trackerScope(observationTracker.repository, "inspector"),
	observationId,
);

const stdoutDirectory = "/fixture/owned-stdout";
const stdoutTimestamp = "2026-10-04T10:00:00.000Z";
const readActivity: typeof readStdoutActivity = (directory) => {
	if (directory !== stdoutDirectory) {
		return Promise.reject(new Error("Stdout read left the captured fixture directory"));
	}
	return Promise.resolve(stdoutTimestamp);
};

const unchangedFixtures = new Map(
	await Promise.all(
		(["fact"] as const).map(async (kind) => {
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
		(["fact"] as const).map(async (kind) => [kind, await publicationFixture(kind)] as const),
	),
);
const driftCases = [
	{ kind: "fact", drift: "host" },
	{ kind: "fact", drift: "closed" },
	{ kind: "fact", drift: "duplicate" },
] as const;
const driftFixtures = new Map(
	await Promise.all(
		driftCases.map(
			async (input) => [`${input.kind}:${input.drift}`, await driftFixture(input)] as const,
		),
	),
);

type RunningSeed = "empty" | "fact" | "stdout" | "both";
type RunningChange =
	| "none"
	| "host"
	| "unbound"
	| "identity"
	| "kind"
	| "run"
	| "stage"
	| "tasks"
	| "closed"
	| "duplicate"
	| "due";
type RunningFailure =
	| "none"
	| "fact-read"
	| "fact-write"
	| "refresh"
	| "stdout-before"
	| "stdout-after";
interface RunningScenario {
	/** Native evidence present before the original snapshot. */
	seed: RunningSeed;
	/** Concurrent native mutation, if any. */
	change: RunningChange;
	/** Mutation between publications or at stdout's final read. */
	point: "after-fact" | "before-stdout";
	/** Injected failure point, including an error after a comment is committed. */
	failure: RunningFailure;
}
const runningDefaults: RunningScenario = {
	seed: "empty",
	change: "none",
	point: "after-fact",
	failure: "none",
};
const authorityChanges = ["host", "unbound", "identity", "kind", "run", "stage"] as const;
const authorityCases = authorityChanges
	.flatMap((change) => [
		{ change, point: "after-fact" as const, seed: "empty" as const },
		{ change, point: "after-fact" as const, seed: "stdout" as const },
	])
	.filter(({ change, seed }) => change !== "kind" || seed !== "empty");
const authorityFixtures = await Promise.all(
	authorityCases.map((scenario) => runningFixture({ ...runningDefaults, ...scenario })),
);
const booleanCases = [
	{ mode: "write", written: true, reads: 1 },
	{ mode: "snapshot-noop", written: false, reads: 0 },
	{ mode: "fresh-duplicate", written: false, reads: 1 },
	{ mode: "closed", written: false, reads: 1 },
] as const;
const booleanFixtures = await Promise.all(
	booleanCases.map(async ({ mode }) => {
		const fixture = await publicationFixture("fact");
		if (mode === "snapshot-noop") {
			await fixture.publish();
		}
		const snapshot = await fixture.tracker.beads.show(fixture.scope, fixture.id);
		if (mode === "fresh-duplicate") {
			await fixture.publish();
		} else if (mode === "closed") {
			await fixture.tracker.beads.close(fixture.scope, fixture.id);
		}
		fixture.show.mockClear();
		return { ...fixture, snapshot };
	}),
);
const publicationFailures = ["fact-read", "fact-write"] as const;
const publicationFailureFixtures = await Promise.all(
	publicationFailures.map((failure) => runningFixture({ ...runningDefaults, failure })),
);
// Warm publication, authority rejection and metadata reads on separate fixtures outside test timing.
const runningWarmup = await runningFixture(runningDefaults);
await publishRunningObservations(
	runningWarmup.context,
	runningWarmup.receipt,
	runningWarmup.snapshot,
	readActivity,
);
const stdoutWarmup = await publicationFixture("stdout");
await stdoutWarmup.publish();
await Promise.all([stdoutWarmup.publish(), stdoutWarmup.publish()]);

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

test("new attempts start with unknown activity and first output bypasses the throttle", () => {
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

test.each(["fact"] as const)(
	"unchanged %s uses zero snapshot reads but standalone publication still reads once",
	async (kind) => {
		const fixture = unchangedFixtures.get(kind)!;
		const { snapshot } = fixture;
		const standaloneShow = mock(fixture.tracker.beads.show);
		// Both paths remain unchanged while their native read counts are observed independently.
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

test.each(["fact"] as const)(
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
		expect(result.comments.map(({ text }) => text)).toEqual([
			"Colony observation: waiting: dependency",
		]);
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

test.each(authorityCases)(
	"running pair rejects native $change at $point with $seed initial evidence",
	async (scenario) => {
		const fixture = authorityFixtures[authorityCases.indexOf(scenario)]!;
		await expect(
			publishRunningObservations(fixture.context, fixture.receipt, fixture.snapshot, readActivity),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual(["fact"]);
		const current = await fixture.tracker.beads.show(fixture.scope, fixture.id);
		expect(
			current.comments.filter(({ text }) => text.startsWith("Colony observation:")),
		).toHaveLength(ONE);
	},
);

test.each([...booleanCases])(
	"fact publication returns $written for $mode, not eligibility or read success",
	async (scenario) => {
		const fixture = booleanFixtures[booleanCases.indexOf(scenario)]!;
		expect(await fixture.publish(fixture.snapshot)).toBe(scenario.written);
		expect(fixture.show).toHaveBeenCalledTimes(scenario.reads);
	},
);

test.each([...publicationFailures])(
	"fact publication rejects native %s failure rather than returning false",
	async (failure) => {
		const fixture = publicationFailureFixtures[publicationFailures.indexOf(failure)]!;
		await expect(
			publishObservation(fixture.context, fixture.id, "running: attempt 1", fixture.snapshot),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual([]);
	},
);

// --- Fixtures ---
async function runningFixture(scenario: RunningScenario) {
	const fixture = await publicationFixture("stdout");
	const { tracker, scope, id, receipt } = fixture;
	const original = await tracker.beads.show(scope, id);
	const anchors = {
		original: original.dependencies[ZERO]!.id,
		other: await createTask(tracker),
		run: await createTask(tracker),
	};
	if (scenario.change === "run" || scenario.change === "stage") {
		await tracker.beads.update(scope, [id], {
			description: JSON.stringify({
				...JSON.parse(original.description),
				assignment: { kind: "stage", runId: anchors.run, stageId: anchors.original },
			}),
		});
	}
	if (scenario.seed === "fact" || scenario.seed === "both") {
		await publishObservation(tracker, id, "running: attempt 1");
	}
	if (scenario.seed === "stdout" || scenario.seed === "both") {
		await seedStdout(fixture, stdoutTimestamp, "2026-10-04T10:00:00.000Z");
	}
	const snapshot = await tracker.beads.show(scope, id);
	const trace: string[] = [];
	const writes: string[] = [];
	let reads = ZERO;
	let changed = false;
	let failed = false;
	const mutate = async () => {
		if (changed || scenario.change === "none") {
			return;
		}
		changed = true;
		await mutateRunning(fixture, scenario.change, anchors);
	};
	const show = mock(async (...args: Parameters<typeof tracker.beads.show>) => {
		reads += ONE;
		trace.push("show");
		if (
			!failed &&
			((scenario.failure === "fact-read" && reads === ONE) ||
				(scenario.failure === "refresh" && reads === TWO))
		) {
			failed = true;
			throw new Error("Injected native read failure");
		}
		if (scenario.point === "before-stdout" && reads === THREE) {
			await mutate();
		}
		return tracker.beads.show(...args);
	});
	const add = async (...args: Parameters<typeof tracker.beads.comments.add>) => {
		let kind = "stdout";
		if (args[TWO].startsWith("Colony observation:")) {
			kind = "fact";
		}
		if (
			!failed &&
			((scenario.failure === "fact-write" && kind === "fact") ||
				(scenario.failure === "stdout-before" && kind === "stdout"))
		) {
			failed = true;
			throw new Error("Injected native comment failure");
		}
		const result = await tracker.beads.comments.add(...args);
		trace.push(kind);
		writes.push(kind);
		if (kind === "fact" && scenario.point === "after-fact") {
			await mutate();
		}
		if (!failed && scenario.failure === "stdout-after" && kind === "stdout") {
			failed = true;
			throw new Error("Injected failure after native comment commitment");
		}
		return result;
	};
	const context = {
		...tracker,
		beads: { ...tracker.beads, show, comments: { ...tracker.beads.comments, add } },
	};
	return { ...fixture, context, receipt, snapshot, show, trace, writes };
}

async function mutateRunning(
	fixture: Awaited<ReturnType<typeof publicationFixture>>,
	change: RunningChange,
	anchors: { original: string; other: string; run: string },
) {
	const { tracker, scope, id } = fixture;
	if (change === "closed") {
		await tracker.beads.close(scope, id);
	} else if (change === "duplicate") {
		await seedStdout(fixture, stdoutTimestamp, "2026-10-05T10:00:00.000Z");
	} else if (change === "due") {
		await seedStdout(fixture, "2026-10-03T10:00:00.000Z", "2026-10-05T10:00:00.000Z");
	} else if (change === "identity") {
		await tracker.beads.update(scope, [id], { assignee: "another-bee" });
	} else {
		const current = await tracker.beads.show(scope, id);
		const description = JSON.parse(current.description);
		if (change === "host") {
			description.host = "another-host";
		} else if (change === "unbound") {
			delete description.host;
		} else if (change === "kind") {
			description.assignment = { kind: "stage", runId: anchors.run, stageId: anchors.original };
		} else if (change === "run") {
			description.assignment.runId = anchors.other;
		} else {
			if (change === "stage") {
				description.assignment.stageId = anchors.other;
			} else {
				description.assignment.runId = anchors.other;
			}
			await tracker.beads.dep.remove(scope, id, anchors.original);
			await tracker.beads.dep.add(scope, id, anchors.other, "related");
		}
		await tracker.beads.update(scope, [id], { description: JSON.stringify(description) });
	}
}

function seedStdout(
	fixture: Awaited<ReturnType<typeof publicationFixture>>,
	lastOutputAt: string,
	recordedAt: string,
) {
	return fixture.tracker.beads.comments.add(
		fixture.scope,
		fixture.id,
		`${COLONY_STDOUT_PREFIX} ${JSON.stringify({
			attemptId: fixture.receipt.id,
			attemptNumber: fixture.receipt.attemptNumber,
			lastOutputAt,
			recordedAt,
		})}`,
	);
}

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
		return publishStdoutActivity(input, receipt, false, snapshot, readActivity);
	};
	return { tracker, id, scope, show, context, receipt, publish };
}
