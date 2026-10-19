import { expect, test } from "bun:test";
import { nurseFixture, seal, seedReports } from "./nurse.test-support.ts";
import type { NativeWorkflowState } from "@hive/shared";
import { reconcileNurse } from "./nurse.ts";

const BATCH = 25;
const FORMAT_VERSION = 1;

test.each(["pending", "unclassified", "failed", "cancelled"] as const)(
	"#test-303 nurse coverage retains its batch when native workflow disposition is %s",
	// eslint-disable-next-line max-statements -- Keep the full coverage refusal setup and assertions measured together.
	async (outcome) => {
		const fixture = await nurseFixture();
		await fixture.activate();
		seedReports(fixture, BATCH);
		try {
			await reconcileNurse(fixture.runtime);
			await seal(fixture);
			const before = fixture.store.nurseCheckpoint(fixture.repository.root)!;
			const active = before.active!;
			if (active.phase !== "submitted") {
				throw new Error("Expected submitted audit");
			}
			let lifecycle: NativeWorkflowState = { kind: "pending" };
			if (outcome === "unclassified") {
				lifecycle = { kind: "unavailable", reason: "unclassified_closure" };
			} else if (outcome === "failed" || outcome === "cancelled") {
				lifecycle = {
					kind: "terminal",
					closedAt: "sampled",
					fact: {
						kind: "busybee-lifecycle",
						formatVersion: FORMAT_VERSION,
						scope: "run",
						runId: active.runId,
						outcome,
						reason: "Fixture disposition",
					},
				};
			}
			fixture.runtime.nurse = {
				...fixture.runtime.nurse,
				inspect: () => Promise.resolve(lifecycle),
			};
			await reconcileNurse(fixture.runtime);
			expect(fixture.store.nurseCheckpoint(fixture.repository.root)).toEqual(before);
		} finally {
			fixture.store.close();
		}
	},
);
