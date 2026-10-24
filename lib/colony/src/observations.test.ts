/* eslint-disable max-statements -- Keep authority mutations, failure injection and publication order together. */
/* eslint-disable unicorn/no-null -- Tests distinguish no output from observed stdout. */
import type { Bead, BeadRecord, BeadsService } from "@hive/beads";
import { COLONY_OBSERVATION_PREFIX, COLONY_STDOUT_PREFIX, spawnRequestLabels } from "@hive/shared";
import type { ObservationContext, readStdoutActivity } from "./observations.ts";
import type { Recipe, WorkflowAssignment } from "@hive/shared";
import { expect, mock, test } from "bun:test";
import {
	publishObservation,
	publishRunningObservations,
	stdoutActivityDue,
} from "./observations.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Bind fixture authority to the publication host.
import { hostname } from "node:os";
import { trackerScope } from "./tracker.ts";

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const stdoutDirectory = "/fixture/owned-stdout";
const stdoutTimestamp = "2026-10-04T10:00:00.000Z";
const readActivity: typeof readStdoutActivity = (directory) => {
	if (directory !== stdoutDirectory) {
		return Promise.reject(new Error("Stdout read left the captured fixture directory"));
	}
	return Promise.resolve(stdoutTimestamp);
};

const driftCases = [
	{ kind: "fact", drift: "host" },
	{ kind: "fact", drift: "closed" },
	{ kind: "fact", drift: "duplicate" },
] as const;
const runningDefaults = { seed: "empty", change: "none", failure: "none" } as const;
const recipe: Recipe = {
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "Complete assigned tasks",
	system_prompt: "Worker role",
};

const authorityChanges = ["host", "unbound", "identity", "kind", "run", "stage"] as const;
const authorityCases = authorityChanges
	.flatMap((change) => [
		{ change, point: "after-fact" as const, seed: "empty" as const },
		{ change, point: "after-fact" as const, seed: "stdout" as const },
	])
	.filter(({ change, seed }) => change !== "kind" || seed !== "empty");
const booleanCases = [
	{ mode: "write", written: true, reads: 1 },
	{ mode: "snapshot-noop", written: false, reads: 0 },
	{ mode: "fresh-duplicate", written: false, reads: 1 },
	{ mode: "closed", written: false, reads: 1 },
] as const;
const publicationFailures = ["fact-read", "fact-write"] as const;
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
	const { tracker, id } = publicationFixture();
	await publishObservation(tracker, id, "waiting: dependency");
	await publishObservation(tracker, id, "waiting: dependency");
	await publishObservation(tracker, id, "waiting: capacity");
	const request = await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id);
	expect(request.comments.map(({ author, text }) => ({ author, text }))).toEqual([
		{ author: "sys-colony", text: "Colony observation: waiting: dependency" },
		{ author: "sys-colony", text: "Colony observation: waiting: capacity" },
	]);
});

test("unchanged fact uses zero snapshot reads but standalone publication still reads once", async () => {
	const fixture = publicationFixture();
	seedFact(fixture);
	const snapshot = await fixture.tracker.beads.show(fixture.scope, fixture.id);
	fixture.show.mockClear();
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
});

test("due fact refreshes once and retains native publication attribution", async () => {
	const fixture = publicationFixture();
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
});

test.each([...driftCases])(
	"due $kind publication rechecks native $drift drift after its phase snapshot",
	async ({ drift }) => {
		const { tracker, scope, id, show, publish, snapshot, before } = driftFixture(drift);
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
		const fixture = runningFixture({ ...runningDefaults, ...scenario });
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
		const fixture = booleanFixture(scenario.mode);
		expect(await fixture.publish(fixture.snapshot)).toBe(scenario.written);
		expect(fixture.show).toHaveBeenCalledTimes(scenario.reads);
	},
);

test.each([...publicationFailures])(
	"fact publication rejects native %s failure rather than returning false",
	async (failure) => {
		const fixture = runningFixture({ ...runningDefaults, failure });
		await expect(
			publishObservation(fixture.context, fixture.id, "running: attempt 1", fixture.snapshot),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.writes).toEqual([]);
	},
);

test("running pair publishes fact before stdout from the sampled source", async () => {
	const fixture = runningFixture(runningDefaults);
	const add = mock(fixture.context.beads.comments.add);
	const context = { ...fixture.context, beads: { ...fixture.context.beads, comments: { add } } };
	const scope = {
		cwd: fixture.tracker.repository.root,
		db: fixture.tracker.repository.beadsDb,
		actor: "sys-colony",
	};
	await publishRunningObservations(context, fixture.receipt, fixture.snapshot, readActivity);
	expect(fixture.show.mock.calls.map(([readScope]) => readScope)).toEqual([scope, scope, scope]);
	expect(add.mock.calls.map(([writeScope]) => writeScope)).toEqual([scope, scope]);
	expect(fixture.writes).toEqual(["fact", "stdout"]);
	expect(fixture.trace).toEqual(["show", "fact", "show", "show", "stdout"]);
	expect(fixture.record.comments.map(({ author }) => author)).toEqual(["sys-colony", "sys-colony"]);
	expect(fixture.record.comments[ZERO]!.text).toBe(
		`${COLONY_OBSERVATION_PREFIX} running: attempt 1`,
	);
	const stdout = fixture.record.comments[ONE]!.text;
	expect(stdout.startsWith(COLONY_STDOUT_PREFIX)).toBe(true);
	expect(JSON.parse(stdout.slice(COLONY_STDOUT_PREFIX.length))).toEqual({
		attemptId: fixture.receipt.id,
		attemptNumber: fixture.receipt.attemptNumber,
		lastOutputAt: stdoutTimestamp,
		recordedAt: expect.any(String),
	});
});

// --- Fixtures ---
function booleanFixture(mode: (typeof booleanCases)[number]["mode"]) {
	const fixture = publicationFixture();
	if (mode === "snapshot-noop") {
		seedFact(fixture);
	}
	const snapshot = structuredClone(fixture.record);
	if (mode === "fresh-duplicate") {
		seedFact(fixture);
	} else if (mode === "closed") {
		fixture.record.status = "closed";
	}
	return { ...fixture, snapshot };
}

function runningFixture(scenario: {
	seed: "empty" | "stdout";
	change: "none" | (typeof authorityChanges)[number];
	failure: "none" | (typeof publicationFailures)[number];
}) {
	const fixture = publicationFixture();
	const { tracker, record, request } = fixture;
	if (scenario.change === "run" || scenario.change === "stage") {
		request.assignment = { kind: "stage", runId: "run-one", stageId: "task-one" };
		record.description = JSON.stringify(request);
	}
	if (scenario.seed === "stdout") {
		appendComment(
			record,
			"inspector",
			`${COLONY_STDOUT_PREFIX} ${JSON.stringify({
				attemptId: fixture.receipt.id,
				attemptNumber: fixture.receipt.attemptNumber,
				lastOutputAt: stdoutTimestamp,
				recordedAt: "2026-10-04T10:00:00.000Z",
			})}`,
		);
	}
	const snapshot = structuredClone(record);
	const trace: string[] = [];
	const writes: string[] = [];
	const show = mock((...args: Parameters<BeadsService["show"]>) => {
		trace.push("show");
		if (scenario.failure === "fact-read") {
			return Promise.reject(new Error("Injected native read failure"));
		}
		return tracker.beads.show(...args);
	});
	const add: BeadsService["comments"]["add"] = async (...args) => {
		const fact = args[TWO].startsWith(COLONY_OBSERVATION_PREFIX);
		if (scenario.failure === "fact-write" && fact) {
			throw new Error("Injected native comment failure");
		}
		const result = await tracker.beads.comments.add(...args);
		let kind = "stdout";
		if (fact) {
			kind = "fact";
			mutateRunning(fixture, scenario.change);
		}
		trace.push(kind);
		writes.push(kind);
		return result;
	};
	const context: ObservationContext = { ...tracker, beads: { show, comments: { add } } };
	return { ...fixture, context, snapshot, show, trace, writes };
}

function mutateRunning(
	{ record, request }: ReturnType<typeof publicationFixture>,
	change: "none" | (typeof authorityChanges)[number],
) {
	if (change === "none") {
		return;
	}
	if (change === "identity") {
		record.assignee = "another-bee";
	} else if (change === "host") {
		request.host = "another-host";
	} else if (change === "unbound") {
		delete request.host;
	} else if (change === "kind") {
		request.assignment = { kind: "stage", runId: "run-one", stageId: "task-one" };
	} else if (change === "run") {
		request.assignment = { kind: "stage", runId: "another-run", stageId: "task-one" };
	} else {
		request.assignment = { kind: "stage", runId: "run-one", stageId: "another-stage" };
		record.dependencies[ZERO]!.id = "another-stage";
	}
	record.description = JSON.stringify(request);
}

function driftFixture(drift: (typeof driftCases)[number]["drift"]) {
	const fixture = publicationFixture();
	const snapshot = structuredClone(fixture.record);
	if (drift === "host") {
		fixture.request.host = "another-host";
		fixture.record.description = JSON.stringify(fixture.request);
	} else if (drift === "closed") {
		fixture.record.status = "closed";
	} else {
		seedFact(fixture);
	}
	return { ...fixture, snapshot, before: structuredClone(fixture.record) };
}

function publicationFixture() {
	const repository = { beadsDb: "/fixture/tracker.db", root: "/fixture" };
	const request: Recipe & { host?: string; assignment: WorkflowAssignment } = {
		...recipe,
		host: hostname(),
		assignment: { kind: "driver", runId: "task-one" },
	};
	const id = "request-one";
	const timestamp = "2026-10-03T00:00:00.000Z";
	const record: BeadRecord = {
		id,
		title: "Running request",
		issue_type: "task",
		notes: "",
		design: "",
		acceptance_criteria: "",
		assignee: "worker",
		owner: "ct",
		status: "open",
		priority: ONE,
		description: JSON.stringify(request),
		labels: spawnRequestLabels("worker"),
		created_at: timestamp,
		updated_at: timestamp,
		dependencies: [
			{ dependency_type: "related", id: "task-one", title: "Work", status: "open", priority: ONE },
		],
		dependents: [],
		comments: [],
	};
	const records = new Map([[id, record]]);
	const tracker: ObservationContext = {
		repository,
		beads: {
			show: (_scope, target) => Promise.resolve(structuredClone(records.get(target)!)),
			comments: {
				add: (scope, target, text) =>
					Promise.resolve(appendComment(records.get(target)!, scope.actor!, text)),
			},
		},
	};
	const scope = trackerScope(repository, "inspector");
	const show = mock(tracker.beads.show);
	const context: ObservationContext = { ...tracker, beads: { ...tracker.beads, show } };
	const receipt = {
		id: "attempt-one",
		attemptNumber: ONE,
		spawnId: id,
		directory: stdoutDirectory,
	};
	const publish = (snapshot?: Bead, beads = context.beads) =>
		publishObservation({ repository, beads }, id, "waiting: dependency", snapshot);
	return { tracker, id, scope, show, context, receipt, publish, record, request };
}

function seedFact({ record }: ReturnType<typeof publicationFixture>) {
	appendComment(record, "sys-colony", `${COLONY_OBSERVATION_PREFIX} waiting: dependency`);
}

function appendComment(record: BeadRecord, author: string, text: string) {
	const id = record.comments.length + ONE;
	const comment = {
		id,
		issue_id: record.id,
		author,
		created_at: new Date(Date.parse(record.created_at) + id).toISOString(),
		text,
	};
	record.comments.push(comment);
	return { ...comment };
}
