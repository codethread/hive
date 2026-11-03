/* eslint-disable unicorn/no-null -- Retained native control distinguishes absent work explicitly. */
import { expect, test } from "bun:test";
import { seedWorkReview, workReviewFixture } from "./work-review.test-support.ts";
import type { NativeWorkflowState } from "@hive/shared";
import { WorkReviewError } from "./work-review.ts";
import { publishResponse } from "./response-store.ts";
import { reconcileWorkReviews } from "./work-review-runtime.ts";

const FORMAT_VERSION = 1;
const NOW = 0;

test.each(["author", "request"] as const)(
	"native success does not release a review with a changed response %s",
	async (field) => {
		const { fixture, active, response } = await reviewedRequest();
		await changeResponseIdentity({ fixture, response }, field);
		fixture.runtime.workReview.inspect = () =>
			Promise.resolve(nativeState("succeeded", active.runId));
		const result = await reconcileWorkReviews(fixture.runtime, { nextDue: NOW }).catch(
			(error: unknown) => error,
		);
		if (field === "author") {
			expect(result).toBeInstanceOf(WorkReviewError);
		}
		const { control } = await fixture.control();
		expect(control.branches.blocked.active).toMatchObject(active);
		expect(control.branches.blocked.last).toBeNull();
		expect(fixture.submissions).toEqual([]);
	},
);

// --- Private helpers ---

async function reviewedRequest() {
	const fixture = await workReviewFixture();
	const active = await seedWorkReview(fixture, {
		branch: "blocked",
		token: "native-completion",
		controlParent: fixture.parent,
		candidates: [{ taskId: "reviewed-source", fingerprint: "frozen", requestId: null }],
	});
	const response = await publishResponse(
		{ beads: fixture.beads, scope: fixture.scope },
		{ taskId: active.runId, requestId: active.requestId, body: "Reviewed frozen scope" },
	);
	await fixture.beads.close(fixture.scope, active.requestId, { reason: "completed" });
	return { fixture, active, response };
}

async function changeResponseIdentity(
	{ fixture, response }: Pick<Awaited<ReturnType<typeof reviewedRequest>>, "fixture" | "response">,
	field: "author" | "request",
) {
	const record = await fixture.beads.show(fixture.scope, response.responseId);
	const document = JSON.parse(record.description) as Record<string, unknown>;
	if (field === "author") {
		document["author"] = "another-worker";
	} else {
		document["requestId"] = "another-request";
	}
	await fixture.beads.update(fixture.scope, [record.id], {
		description: JSON.stringify(document),
	});
}

function nativeState(outcome: "succeeded", runId: string): NativeWorkflowState {
	return {
		kind: "terminal",
		closedAt: "sampled",
		fact: {
			kind: "busybee-lifecycle",
			formatVersion: FORMAT_VERSION,
			scope: "run",
			runId,
			outcome,
			reason: "Fixture disposition",
		},
	};
}
