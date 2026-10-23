/* eslint-disable unicorn/no-null -- Unbound history is explicit in decoder fixtures. */
import {
	BEE_ACKNOWLEDGMENT_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestColonyObservation,
	latestStdoutActivity,
	projectedRequestLabels,
	readSpawnRequest,
	readSpawnRequestAttribution,
	readSpawnRequestHost,
	readSpawnRequestSummary,
	requestDisposition,
	requestLabelsCurrent,
	requestNeedsAttention,
	requestResolution,
	spawnRequestLabels,
} from "./spawn-request.ts";
import { expect, test } from "bun:test";
import { beadSchema } from "@hive/beads";

const INVALID_HOST_NUMBER = 1;
const original = beadSchema.parse({
	close_reason: "exhausted",
	created_at: "fixture",
	id: "test-old",
	priority: 2,
	status: "closed",
	updated_at: "fixture",
});

const malformedAcknowledgmentFixture = {
	...original,
	closed_at: "closure",
	comments: [
		{
			author: "operator",
			created_at: "fixture",
			id: 1,
			issue_id: original.id,
			text: `${BEE_ACKNOWLEDGMENT_PREFIX} {}`,
		},
	],
};
warmMalformedAcknowledgment();

test("stdout and lifecycle evidence are selected independently of comment order and IDs #test-353", () => {
	const activity = {
		attemptId: "second-attempt",
		attemptNumber: 2,
		// eslint-disable-next-line unicorn/no-null -- A new attempt must not inherit prior stdout.
		lastOutputAt: null,
		recordedAt: "2026-10-04T10:00:00.123Z",
	};
	const comment = { author: "colony", created_at: "2026-10-04 10:00:00", issue_id: original.id };
	const lifecycle = { ...comment, id: 3, text: "Colony observation: running: attempt 2" };
	const bead = {
		...original,
		comments: [
			{ ...comment, id: 1, text: `${COLONY_STDOUT_PREFIX} ${JSON.stringify(activity)}` },
			lifecycle,
			{
				...comment,
				id: 99,
				text:
					`${COLONY_STDOUT_PREFIX} ` +
					`${JSON.stringify({
						...activity,
						attemptId: "first-attempt",
						attemptNumber: 1,
						recordedAt: "2026-10-04T09:59:00.123Z",
						lastOutputAt: "2026-10-04T09:59:00.123Z",
					})}`,
			},
		],
	};
	expect(latestStdoutActivity(original)).toBeUndefined();
	expect(latestStdoutActivity(bead)).toEqual(activity);
	expect(latestColonyObservation(bead)).toEqual(lifecycle);
	const reversed = { ...bead, comments: bead.comments.toReversed() };
	expect(latestStdoutActivity(reversed)).toEqual(activity);
	expect(latestColonyObservation(reversed)).toEqual(lifecycle);
});

test("lifecycle observations remain ordered after local IDs and input order change", () => {
	const older = {
		author: "colony",
		created_at: "2026-10-04T10:00:00Z",
		id: 11,
		issue_id: original.id,
		text: "Colony observation: running",
	};
	const newer = {
		...older,
		created_at: "2026-10-04T10:00:01Z",
		id: 1,
		text: "Colony observation: settled",
	};
	expect(latestColonyObservation({ ...original, comments: [newer, older] })).toEqual(newer);
	expect(latestColonyObservation({ ...original, comments: [{ ...older, id: 99 }, newer] })).toEqual(
		newer,
	);
	const tied = { ...older, id: 2, text: "Colony observation: stopped" };
	const forward = latestColonyObservation({ ...original, comments: [older, tied] });
	const reverse = latestColonyObservation({ ...original, comments: [tied, older] });
	expect(forward).toEqual(reverse);
});

test.each([
	{
		attention: true,
		outcome: "failed",
		reason: "blocked",
		resolution: "unresolved",
		status: "closed",
	},
	{ attention: false, outcome: "pending", reason: "", resolution: "unresolved", status: "open" },
	{
		attention: false,
		outcome: "succeeded",
		reason: "completed",
		resolution: "resolved",
		status: "closed",
	},
	{
		attention: false,
		outcome: "cancelled",
		reason: "cancelled",
		resolution: "resolved",
		status: "closed",
	},
	{
		attention: false,
		outcome: "cancelled",
		reason: "Stopped by Bee",
		resolution: "resolved",
		status: "closed",
	},
	{
		attention: false,
		outcome: "cancelled",
		reason: "Operator no longer needs work",
		resolution: "resolved",
		status: "closed",
	},
	{
		attention: true,
		outcome: "failed",
		reason: "exhausted",
		resolution: "unresolved",
		status: "closed",
	},
	{
		attention: true,
		outcome: "failed",
		reason: "claim_failed",
		resolution: "unresolved",
		status: "closed",
	},
])(
	"$status / $reason has independent resolution and attention",
	({ status, outcome, reason, resolution, attention }) => {
		const bead = { ...original, close_reason: reason, status };
		expect(requestResolution(bead)).toEqual({ kind: resolution });
		expect(requestNeedsAttention(bead)).toBe(attention);
		const disposition = requestDisposition(bead);
		expect(disposition.outcome).toBe(outcome);
		expect(disposition.resolution).toBe(resolution);
	},
);

const replacementCases = (
	[
		{ reason: "exhausted", outcome: "failed" },
		{ reason: "Stopped by Bee", outcome: "cancelled" },
	] as const
).map(({ reason, outcome }) => ({
	outcome,
	bead: beadSchema.parse({
		close_reason: reason,
		created_at: "fixture",
		dependents: [{ dependency_type: "supersedes", id: "test-new", status: "closed" }],
		id: "test-old",
		priority: 2,
		status: "closed",
		updated_at: "fixture",
	}),
}));

test.each(replacementCases)(
	"a replacement exposes provenance while preserving $outcome disposition",
	({ bead, outcome }) => {
		expect(requestResolution(bead)).toEqual({ kind: "superseded", replacementIds: ["test-new"] });
		expect(requestNeedsAttention(bead)).toBe(false);
		expect(requestDisposition(bead)).toEqual({ outcome, resolution: "resolved" });
	},
);

test("publication normalizes both namespaces and retains unrelated labels", () => {
	const bead = {
		...original,
		labels: [
			"system",
			"bee",
			"agent:worker",
			"area:colony",
			"bee-outcome:pending",
			"bee-outcome:failed",
			"bee-resolution:unknown",
		],
	};
	expect(requestLabelsCurrent(bead)).toBe(false);
	const labels = projectedRequestLabels(bead);
	expect(labels).toEqual([
		"system",
		"bee",
		"agent:worker",
		"area:colony",
		"bee-outcome:failed",
		"bee-resolution:unresolved",
	]);
	const published = { ...bead, labels };
	expect(requestLabelsCurrent(published)).toBe(true);
	expect(projectedRequestLabels(published)).toEqual(labels);
});

test("malformed acknowledgment evidence fails visibly", () => {
	expect(() => requestResolution(malformedAcknowledgmentFixture)).toThrow(Error);
});

const recipe = {
	cwd: null,
	effort: "low",
	harness: "fixture",
	kind: "worker",
	model: "fixture",
	prompt: "captured direction",
	system_prompt: "captured role",
};
const driverAssignment = { kind: "driver", runId: "run-1" };
const dependencies = [{ id: "run-1", dependency_type: "related" }];

test.each([
	{ host: "requesting-machine", expected: "requesting-machine" },
	{ host: undefined, expected: null },
])("request decoding retains host $expected independently of the recipe", ({ host, expected }) => {
	const bead = {
		...original,
		assignee: "friendly-bee",
		description: JSON.stringify({ ...recipe, assignment: driverAssignment, host }),
		dependencies,
		labels: spawnRequestLabels(recipe.kind),
	};
	expect(readSpawnRequest(bead)).toMatchObject({
		assignment: driverAssignment,
		host: expected,
		identity: "friendly-bee",
		recipe,
	});
});

test.each([
	{ assignment: { kind: "stage", runId: "run-1", stageId: "stage-1" }, anchor: "stage-1" },
])(
	"native decoding exposes captured $assignment.kind scope separately from recipe",
	({ assignment, anchor }) => {
		const bead = {
			...original,
			assignee: "friendly-bee",
			description: JSON.stringify({ ...recipe, assignment, host: "requesting-machine" }),
			labels: spawnRequestLabels(recipe.kind),
			dependencies: [{ id: anchor, dependency_type: "related" }],
		};
		expect(readSpawnRequest(bead)).toMatchObject({ assignment, recipe, taskIds: [anchor] });
		expect(readSpawnRequestSummary(bead)).toMatchObject({ assignment });
		expect(() => readSpawnRequest({ ...bead, dependencies: [] })).toThrow(Error);
		expect(() =>
			readSpawnRequest({ ...bead, dependencies: [{ id: "other", dependency_type: "related" }] }),
		).toThrow(Error);
	},
);

test.each([
	{ kind: "unknown", runId: "run-1" },
	{ kind: "driver", runId: "" },
	{ kind: "stage", runId: "run-1", stageId: " " },
	{ kind: "driver", runId: "run-1", stageId: "stage-1" },
])("malformed assignment %j fails at the native boundary", (assignment) => {
	expect(() =>
		readSpawnRequestSummary({
			...original,
			assignee: "friendly-bee",
			description: JSON.stringify({ ...recipe, assignment }),
			labels: spawnRequestLabels(recipe.kind),
		}),
	).toThrow(Error);
});

test.each(["", " ", INVALID_HOST_NUMBER, null])(
	"malformed requesting host %j fails at the native boundary",
	(host) => {
		const bead = {
			...original,
			assignee: "friendly-bee",
			description: JSON.stringify({ ...recipe, assignment: driverAssignment, host }),
			dependencies,
			labels: spawnRequestLabels(recipe.kind),
		};
		expect(() => readSpawnRequest(bead)).toThrow(Error);
	},
);

test("request summaries retain validated identity and host without hydrated relations", () => {
	const bead = {
		id: original.id,
		description: JSON.stringify({
			...recipe,
			assignment: driverAssignment,
			host: "requesting-machine",
		}),
		labels: spawnRequestLabels(recipe.kind),
		assignee: "friendly-bee",
	};
	const summary = readSpawnRequestSummary(bead);
	const { taskIds: _taskIds, ...detail } = readSpawnRequest({ ...original, ...bead, dependencies });
	expect(summary).toEqual(detail);
	expect(() => readSpawnRequestSummary({ ...bead, labels: [] })).toThrow(Error);
	expect(() => readSpawnRequestSummary({ ...bead, assignee: "" })).toThrow(Error);
});

test.each([
	{ host: "foreign-host", expected: "foreign-host" },
	{ host: undefined, expected: null },
])(
	"host routing projection reads $expected without decoding workflow execution",
	({ host, expected }) => {
		const bead = { description: JSON.stringify({ host }) };
		expect(readSpawnRequestHost(bead)).toBe(expected);
	},
);

test.each(["", " ", INVALID_HOST_NUMBER, null])(
	"host routing projection rejects malformed provenance %j",
	(host) => {
		expect(() => readSpawnRequestHost({ description: JSON.stringify({ host }) })).toThrow(Error);
	},
);

test("read-only attribution retains task links independently of workflow execution authority #test-660", () => {
	const bead = {
		...original,
		description: JSON.stringify({
			harness: "codex",
			kind: "worker",
			model: "gpt-6-astra",
			host: "another-host",
		}),
		labels: spawnRequestLabels("worker"),
		assignee: "friendly-bee",
		dependencies: [{ id: "work", dependency_type: "related", title: "Work", status: "open" }],
	};
	expect(readSpawnRequestAttribution(bead)).toEqual({
		id: bead.id,
		identity: "friendly-bee",
		recipe: { harness: "codex", kind: "worker", model: "gpt-6-astra" },
		taskIds: ["work"],
	});
	expect(() => readSpawnRequest(bead)).toThrow(Error);
	expect(() => readSpawnRequestAttribution({ ...bead, labels: [] })).toThrow(Error);
	expect(() => readSpawnRequestAttribution({ ...bead, assignee: "" })).toThrow(Error);
});

function warmMalformedAcknowledgment() {
	try {
		requestResolution(malformedAcknowledgmentFixture);
	} catch (error) {
		if (error instanceof Error) {
			return;
		}
		throw error;
	}
	throw new Error("Malformed acknowledgment fixture was not rejected");
}
