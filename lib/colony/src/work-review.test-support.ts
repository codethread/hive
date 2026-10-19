/* eslint-disable unicorn/no-null -- Fixtures use the production native control representation. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import type { WorkReviewInput } from "@hive/shared";
import type { WorkReviewRuntime } from "./work-review-runtime.ts";
import { beesConfigSchema } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture host matches captured request authority.
import { hostname } from "node:os";
import { readWorkReviewControl } from "./work-review-runtime.ts";
import { trackerScope } from "./tracker.ts";

export async function workReviewFixture() {
	const tracker = memoryTracker();
	const parent = await createTask(tracker, { title: "Work reviews" });
	const scope = trackerScope(tracker.repository, "worker");
	const time = { now: 10_000 };
	const submissions: { input: WorkReviewInput; runId: string; requestId: string }[] = [];
	const effects = { scans: 0, retries: 0, stopped: true };
	const runtime: WorkReviewRuntime = {
		...tracker,
		state: "/fixture/state",
		actor: "worker",
		host: hostname(),
		now: () => time.now,
		config: beesConfigSchema.parse({
			owner: "ct",
			humans: ["ct"],
			formulas: {},
			auto_work_reviews: { kind: "drone", parent },
		}),
		workReview: {
			attach: () => {
				throw new Error("Fixture has no orphan run");
			},
			assertTracker: () => {
				effects.scans += 1;
				return Promise.resolve();
			},
			start: async ({ input }) => {
				const runId = await createTask(tracker, { parent, description: input.token });
				const requestId = await createSpawn(tracker, runId);
				submissions.push({ input, runId, requestId });
				return { runId, requestId };
			},
			show: () => Promise.resolve({ status: "done" }),
			stopped: () => Promise.resolve(effects.stopped),
			continuation: () =>
				Promise.resolve({ checkpoint: "checkpoint", savedAt: "saved", currentHash: "definition" }),
			retry: async ({ requestId }) => {
				effects.retries += 1;
				const native = await tracker.beads.show(scope, requestId);
				const related = native.dependencies.find((edge) => edge.dependency_type === "related")!;
				const replacement = await createSpawn(tracker, related.id, {
					description: native.description,
					deps: [
						{ id: related.id, type: "related" },
						{ id: requestId, type: "supersedes" },
					],
				});
				return { requestId: replacement };
			},
		},
	};
	return {
		...tracker,
		runtime,
		parent,
		scope,
		time,
		submissions,
		effects,
		control: () => readWorkReviewControl(runtime),
	};
}

// eslint-disable-next-line max-statements -- Prepare current source state and matching unsuccessful request facts.
export async function failedWork(
	fixture: Awaited<ReturnType<typeof workReviewFixture>>,
	options: {
		status?: "blocked" | "in_progress";
		openAnchor?: boolean;
		cancelled?: boolean;
	} = {},
) {
	const source = await createTask(fixture, { status: options.status ?? "in_progress" });
	let anchor = source;
	if (options.openAnchor) {
		anchor = await createTask(fixture, { parent: source });
	}
	const requestId = await createSpawn(fixture, anchor);
	let reason = "exhausted";
	if (options.cancelled) {
		reason = "cancelled";
	}
	await fixture.beads.close(fixture.scope, requestId, { reason });
	let labels = ["system", "bee", "agent:worker", "bee-outcome:failed", "bee-resolution:unresolved"];
	if (options.cancelled) {
		labels = ["system", "bee", "agent:worker", "bee-outcome:cancelled", "bee-resolution:resolved"];
	}
	await fixture.beads.update(fixture.scope, [requestId], { setLabels: labels });
	return { source, anchor, requestId };
}

/** Seed prior native review state without executing scheduling or recovery under test. */
export async function seedWorkReview(
	fixture: Awaited<ReturnType<typeof workReviewFixture>>,
	input: WorkReviewInput,
) {
	const runId = await createTask(fixture, { parent: fixture.parent, description: input.token });
	const requestId = await createSpawn(fixture, runId);
	const { control } = await fixture.control();
	control.branches[input.branch] = {
		nextDue: fixture.time.now,
		cursor: null,
		last: null,
		active: {
			token: input.token,
			phase: "submitted",
			candidates: input.candidates,
			runId,
			requestId,
			detail: "",
		},
	};
	await fixture.beads.update(fixture.scope, [fixture.parent], { notes: JSON.stringify(control) });
	return { runId, requestId };
}
