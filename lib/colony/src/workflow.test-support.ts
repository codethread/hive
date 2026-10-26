/* eslint-disable unicorn/no-null -- The consumed control explicitly has no lock or settlement by default. */
import type { BeadRecord } from "@hive/beads";
import type { WorkflowControl } from "@hive/shared";
import { memoryTracker } from "./tracker.test-support.ts";

const PRIORITY = 2;
const OBSERVED = "2026-10-25T00:00:00Z";

/** Typed hydrated reads isolate consumer policy from native adapter/schema setup. */
export function workflowFixture(input: Partial<WorkflowControl> = {}) {
	const context = memoryTracker();
	const control: WorkflowControl = {
		formatVersion: 2,
		id: "run",
		lock: null,
		managedExecution: "managed",
		results: {},
		completions: {},
		settlement: null,
		created: [{ bead: "stage", scope: "visit" }],
		...input,
	};
	const run = record("run");
	const stage = record("stage");
	const checkpoint = {
		...record("checkpoint"),
		labels: ["system", "busybee-checkpoint"],
		description: JSON.stringify(control),
	};
	run.dependencies.push({
		id: checkpoint.id,
		dependency_type: "related",
		title: checkpoint.title,
		status: checkpoint.status,
		priority: PRIORITY,
	});
	stage.dependencies.push({
		id: run.id,
		dependency_type: "parent-child",
		title: run.title,
		status: run.status,
		priority: PRIORITY,
	});
	const records = new Map([run, stage, checkpoint].map((item) => [item.id, item]));
	const select = (id: string) => {
		const found = records.get(id);
		if (!found) {
			throw new Error(`Missing fixture record ${id}`);
		}
		return { ...found };
	};
	return {
		...context,
		control,
		run,
		stage,
		checkpoint,
		beads: {
			...context.beads,
			listProjected: () =>
				Promise.resolve({ issues: [], total: 0, limit: 0, offset: 0, has_more: false }),
			show: (_scope: unknown, id: string) => Promise.resolve(select(id)),
			showMany: (_scope: unknown, ids: readonly string[]) =>
				Promise.resolve(ids.map((id) => select(id))),
		},
	};
}

function record(id: string): BeadRecord {
	return {
		id,
		title: id,
		labels: [],
		status: "open",
		priority: PRIORITY,
		issue_type: "task",
		description: "",
		created_at: OBSERVED,
		updated_at: OBSERVED,
		notes: "Authored notes",
		design: "",
		acceptance_criteria: "",
		dependencies: [],
		dependents: [],
		comments: [],
	};
}
