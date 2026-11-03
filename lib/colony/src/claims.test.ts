import { beforeTrackerWrite, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { CommandError } from "@hive/beads";
import type { OperationEvidence } from "./history.ts";
import { acquireClaim } from "./claims.ts";
import { trackerScope } from "./tracker.ts";

const FIRST = 0;

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

test.each([
	{ input: { assignee: "ct" }, outcome: "conflict" },
	{ input: { assignee: "another-driver" }, outcome: "conflict" },
	{ input: { labels: ["hitl"] }, outcome: "conflict" },
])(
	"claim leaves reserved or closed tasks unchanged: $outcome $input",
	async ({ input, outcome }) => {
		const tracker = memoryTracker();
		const reserved = await createTask(tracker, input);
		const before = await tracker.beads.show(
			trackerScope(tracker.repository, "inspector"),
			reserved,
		);
		expect(
			await acquireClaim(
				tracker,
				{ identity: "worker", assignment: { kind: "driver", runId: reserved } },
				reserved,
				operationEvidence(),
			),
		).toBe(outcome);
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
	expect(
		await acquireClaim(
			{ ...tracker, beads },
			{ identity: "worker", assignment: { kind: "driver", runId: id } },
			id,
			evidence,
		),
	).toBe("conflict");
	expect(await tracker.beads.show(trackerScope(tracker.repository, "inspector"), id)).toMatchObject(
		{
			assignee: "another-bee",
			owner: "ct",
		},
	);
	expect(evidence.failures[FIRST]).toBeInstanceOf(CommandError);
	expect(evidence.effects).toEqual([]);
});
