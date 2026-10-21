/* eslint-disable max-statements -- Exercise complete polling lifetimes and overlapping refresh outcomes. */
import { createWorkflowResource, snapshot } from "./src/data.ts";
import { expect, test } from "bun:test";
import type { WorkflowInspection } from "./contracts.ts";
import { pollVisibleWorkflow } from "./src/workflow-polling.ts";

const INSPECTIONS = 2;
const POLL_MS = 5000;
const saved: WorkflowInspection = {
	formatVersion: 1,
	runId: "run",
	title: "Workflow",
	checkpoint: "checkpoint",
	savedAt: "original",
	definition: {
		label: "example",
		savedHash: "source",
		currentHash: "source",
		sourceMatch: "exact",
	},
	actors: [],
};

test("opening in a hidden document waits for visibility before the initial read", () => {
	const fixture = pollingFixture(false);
	const stop = pollVisibleWorkflow(fixture.refresh, fixture.environment);
	fixture.tick();
	expect(fixture.reads).toEqual([]);
	fixture.visibility(true);
	expect(fixture.reads).toEqual([false]);
	stop();
});

test("unchanged checkpoints retain the exact displayed resource and skip full inspection #test-607", async () => {
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			return Promise.resolve(saved);
		},
		checkpoint: () => Promise.resolve(saved),
	});
	await resource.load("selected/run", "/workflow");
	const original = resource.store.getState().entries["selected/run"];
	await resource.load("selected/run", "/workflow", true);
	expect(resource.store.getState().entries["selected/run"]).toBe(original);
	expect(inspections).toBe(1);
});

test("changed polling and manual requests coalesce without clearing the displayed snapshot", async () => {
	const update = Promise.withResolvers<WorkflowInspection>();
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			if (inspections === 1) {
				return Promise.resolve(saved);
			}
			return update.promise;
		},
		checkpoint: () => Promise.resolve({ ...saved, savedAt: "newer" }),
	});
	await resource.load("selected/run", "/workflow");
	const original = resource.store.getState().entries["selected/run"];
	const polling = resource.load("selected/run", "/workflow", true);
	const overlapping = resource.load("selected/run", "/workflow", true);
	const manual = resource.load("selected/run", "/workflow");
	expect(overlapping).toBe(polling);
	expect(manual).toBe(polling);
	expect(resource.store.getState().entries["selected/run"]).toBe(original);
	update.resolve({ ...saved, savedAt: "newer" });
	await polling;
	expect(inspections).toBe(INSPECTIONS);
	expect(snapshot(resource.store.getState().entries["selected/run"]!)?.savedAt).toBe("newer");
});

test("manual refresh promotes an overlapping unchanged probe to full inspection #test-631", async () => {
	const checkpoint = Promise.withResolvers<WorkflowInspection>();
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			return Promise.resolve(saved);
		},
		checkpoint: () => checkpoint.promise,
	});
	await resource.load("selected/run", "/workflow");
	const polling = resource.load("selected/run", "/workflow", true);
	expect(resource.load("selected/run", "/workflow")).toBe(polling);
	checkpoint.resolve(saved);
	await polling;
	expect(inspections).toBe(INSPECTIONS);
});

test.each(["checkpoint"])(
	"polling recovers after a failed %s read with the snapshot intact",
	async (failure) => {
		let fail = false;
		const resource = createWorkflowResource({
			inspect: () => Promise.resolve(saved),
			checkpoint: () => {
				if (fail && failure === "checkpoint") {
					return Promise.reject(new Error("Read failed"));
				}
				return Promise.resolve({ ...saved, savedAt: "newer" });
			},
		});
		await resource.load("selected/run", "/workflow");
		fail = true;
		await resource.load("selected/run", "/workflow", true);
		expect(resource.store.getState().entries["selected/run"]?.kind).toBe("failed");
		expect(snapshot(resource.store.getState().entries["selected/run"]!)).toBe(saved);
		fail = false;
		await resource.load("selected/run", "/workflow", true);
		expect(resource.store.getState().entries["selected/run"]?.kind).toBe("ready");
		expect(snapshot(resource.store.getState().entries["selected/run"]!)).toBe(saved);
	},
);

function pollingFixture(initiallyVisible = true) {
	const reads: boolean[] = [];
	let visible = initiallyVisible;
	let tick = () => {};
	let changed = () => {};
	return {
		reads,
		refresh: (conditional: boolean) => {
			reads.push(conditional);
			return Promise.resolve();
		},
		tick: () => {
			tick();
		},
		visibility: (next: boolean) => {
			visible = next;
			changed();
		},
		environment: {
			visible: () => visible,
			subscribe: (listener: () => void) => {
				changed = listener;
				return () => {
					changed = () => {};
				};
			},
			schedule: (read: () => void, ms: number) => {
				expect(ms).toBe(POLL_MS);
				tick = read;
				return () => {
					tick = () => {};
				};
			},
		},
	};
}
