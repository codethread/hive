import {
	beforeTrackerWrite,
	createTask,
	createWorkflowControl,
	memoryTracker,
} from "./tracker.test-support.ts";
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
	{ input: { status: "closed" }, outcome: "closed" },
])(
	"claim leaves reserved or closed tasks unchanged: $outcome $input #test-566",
	async ({ input, outcome }) => {
		const tracker = memoryTracker();
		const reserved = await createTask(tracker, input);
		await createWorkflowControl(tracker, reserved);
		const before = await tracker.beads.show(
			trackerScope(tracker.repository, "inspector"),
			reserved,
		);
		const claim = acquireClaim(
			tracker,
			{ identity: "worker", assignment: { kind: "driver", runId: reserved } },
			reserved,
			operationEvidence(),
		);
		if (outcome === "closed") {
			await expect(claim).rejects.toBeInstanceOf(Error);
		} else {
			expect(await claim).toBe(outcome);
		}
		expect(
			await tracker.beads.show(trackerScope(tracker.repository, "inspector"), reserved),
		).toEqual(before);
	},
);

test("a reservation changed after inspection produces a claim conflict with retained evidence #test-560", async () => {
	const tracker = memoryTracker();
	const id = await createTask(tracker);
	await createWorkflowControl(tracker, id);
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
