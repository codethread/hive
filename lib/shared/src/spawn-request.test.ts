/* eslint-disable unicorn/no-null -- Unbound history is explicit in decoder fixtures. */
import {
	BEE_ACKNOWLEDGMENT_PREFIX,
	COLONY_STDOUT_PREFIX,
	latestColonyObservation,
	latestStdoutActivity,
	projectedRequestLabels,
	readSpawnRequest,
	requestAcknowledgment,
	requestDisposition,
	requestLabelsCurrent,
	requestNeedsAttention,
	requestResolution,
	spawnRequestLabels,
} from "./spawn-request.ts";
import { expect, test } from "bun:test";
import { beadSchema } from "./bees-io.ts";

const FIRST = 0;
const INVALID_HOST_NUMBER = 1;
const original = beadSchema.parse({
	close_reason: "exhausted",
	created_at: "fixture",
	id: "test-old",
	priority: 2,
	status: "closed",
	updated_at: "fixture",
});

test("stdout inspection uses publication time independently of renumbered IDs and native timestamps", () => {
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
				text: `${COLONY_STDOUT_PREFIX} ${JSON.stringify({ ...activity, attemptId: "first-attempt", attemptNumber: 1, recordedAt: "2026-10-04T09:59:00.123Z", lastOutputAt: "2026-10-04T09:59:00.123Z" })}`,
			},
		],
	};
	expect(latestStdoutActivity(original)).toBeUndefined();
	expect(latestStdoutActivity(bead)).toEqual(activity);
	expect(latestColonyObservation(bead)).toEqual(lifecycle);
	expect(bead.comments[FIRST]?.created_at).toBe(comment.created_at);
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

test("a replacement resolves its predecessor regardless of replacement outcome", () => {
	const bead = beadSchema.parse({
		close_reason: "exhausted",
		created_at: "fixture",
		dependents: [{ dependency_type: "supersedes", id: "test-new", status: "closed" }],
		id: "test-old",
		priority: 2,
		status: "closed",
		updated_at: "fixture",
	});
	expect(requestResolution(bead)).toEqual({ kind: "superseded", replacementIds: ["test-new"] });
	expect(requestNeedsAttention(bead)).toBe(false);
	expect(requestDisposition(bead)).toEqual({ outcome: "failed", resolution: "resolved" });
	expect(bead.close_reason).toBe("exhausted");
});

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

// eslint-disable-next-line max-statements -- One closure fixture checks acceptance, native attribution and competing provenance together.
test("the first acknowledgment of this closure resolves attention with native attribution", () => {
	const closedAt = "2026-10-04T10:00:00.123456Z";
	const comment = { author: "operator", created_at: "2026-10-04T11:00:00Z", issue_id: original.id };
	const first = {
		...comment,
		id: 2,
		text: `${BEE_ACKNOWLEDGMENT_PREFIX} ${JSON.stringify({ closedAt, reason: "Handled elsewhere" })}`,
	};
	const bead = {
		...original,
		closed_at: closedAt,
		comments: [
			{
				...comment,
				author: "z-later-operator",
				id: 3,
				text: `${BEE_ACKNOWLEDGMENT_PREFIX} ${JSON.stringify({ closedAt, reason: "Later acknowledgment" })}`,
			},
			{
				...comment,
				id: 1,
				text: `${BEE_ACKNOWLEDGMENT_PREFIX} ${JSON.stringify({ closedAt: "earlier closure", reason: "Old acknowledgment" })}`,
			},
			first,
		],
	};
	expect(requestResolution(bead)).toEqual({ kind: "acknowledged" });
	expect(requestAcknowledgment(bead)).toEqual({
		acknowledgedAt: comment.created_at,
		actor: comment.author,
		reason: "Handled elsewhere",
	});
	expect(
		requestAcknowledgment({
			...bead,
			comments: bead.comments.map((entry, index) => ({ ...entry, id: index })),
		}),
	).toEqual(requestAcknowledgment(bead));
	expect(requestDisposition(bead)).toEqual({ outcome: "failed", resolution: "resolved" });
	expect(requestNeedsAttention(bead)).toBe(false);
	expect(projectedRequestLabels(bead)).toEqual(["bee-outcome:failed", "bee-resolution:resolved"]);
	expect(requestNeedsAttention({ ...bead, closed_at: "another closure" })).toBe(true);
	expect(requestResolution({ ...bead, status: "open" })).toEqual({ kind: "unresolved" });
	expect(requestResolution({ ...bead, close_reason: "completed" })).toEqual({ kind: "resolved" });
	expect(
		requestResolution({
			...bead,
			dependents: [{ dependency_type: "supersedes", id: "replacement" }],
		}),
	).toEqual({ kind: "superseded", replacementIds: ["replacement"] });
});

test("malformed acknowledgment evidence fails visibly", () => {
	const bead = {
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
	expect(() => requestResolution(bead)).toThrow(Error);
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

test.each([
	{ host: "requesting-machine", expected: "requesting-machine" },
	{ host: undefined, expected: null },
])("request decoding retains host $expected independently of the recipe", ({ host, expected }) => {
	const bead = {
		...original,
		assignee: "friendly-bee",
		description: JSON.stringify({ ...recipe, host }),
		labels: spawnRequestLabels(recipe.kind),
	};
	expect(readSpawnRequest(bead)).toMatchObject({
		host: expected,
		identity: "friendly-bee",
		recipe,
	});
});

test.each(["", " ", INVALID_HOST_NUMBER, null])(
	"malformed requesting host %j fails at the native boundary",
	(host) => {
		const bead = {
			...original,
			assignee: "friendly-bee",
			description: JSON.stringify({ ...recipe, host }),
			labels: spawnRequestLabels(recipe.kind),
		};
		expect(() => readSpawnRequest(bead)).toThrow(Error);
	},
);
