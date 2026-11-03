/* eslint-disable max-statements -- Exercise complete polling lifetimes and overlapping refresh outcomes. */
import type { WorkflowInspection, WorkflowLifecycle, WorkflowView } from "./contracts.ts";
import { createWorkflowResource, snapshot } from "./src/data.ts";
import { expect, test } from "bun:test";
import { pollVisibleWorkflow } from "./src/workflow-polling.ts";

const INSPECTIONS = 2;
const RECOVERY_INSPECTIONS = 3;
const POLL_MS = 5000;
const graph: WorkflowInspection = {
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
const native: WorkflowLifecycle = {
	runId: "run",
	nativeStatus: "in_progress",
	updatedAt: "updated",
	publication: { checkpoint: "checkpoint", savedAt: "original", locked: false, settlement: "none" },
	lifecycle: { kind: "pending" },
	resolution: { kind: "unresolved" },
};
const saved: WorkflowView = {
	...native,
	diagram: { kind: "available", mode: "instructions", data: graph },
};

test("visible inspector polls every five seconds, pauses hidden and stops on close", () => {
	const fixture = pollingFixture();
	const stop = pollVisibleWorkflow(fixture.refresh, fixture.environment);
	expect(fixture.reads).toEqual([false]);
	fixture.tick();
	expect(fixture.reads).toEqual([false, true]);
	fixture.visibility(false);
	fixture.tick();
	expect(fixture.reads).toEqual([false, true]);
	fixture.visibility(true);
	expect(fixture.reads).toEqual([false, true, true]);
	stop();
	fixture.tick();
	fixture.visibility(true);
	expect(fixture.reads).toEqual([false, true, true]);
});

test("opening in a hidden document waits for visibility before the initial read", () => {
	const fixture = pollingFixture(false);
	const stop = pollVisibleWorkflow(fixture.refresh, fixture.environment);
	fixture.tick();
	expect(fixture.reads).toEqual([]);
	fixture.visibility(true);
	expect(fixture.reads).toEqual([false]);
	stop();
});

test("unchanged native facts retain the exact displayed resource and skip full inspection #test-607", async () => {
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			return Promise.resolve(saved);
		},
		lifecycle: () => Promise.resolve(native),
	});
	await resource.load("selected/run", "/workflow");
	const original = resource.store.getState().entries["selected/run"];
	await resource.load("selected/run", "/workflow", true);
	expect(resource.store.getState().entries["selected/run"]).toBe(original);
	expect(inspections).toBe(1);
});

test("changed polling and manual requests coalesce without clearing the displayed snapshot", async () => {
	const update = Promise.withResolvers<WorkflowView>();
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			if (inspections === 1) {
				return Promise.resolve(saved);
			}
			return update.promise;
		},
		lifecycle: () =>
			Promise.resolve({ ...native, publication: { ...native.publication, savedAt: "newer" } }),
	});
	await resource.load("selected/run", "/workflow");
	const original = resource.store.getState().entries["selected/run"];
	const polling = resource.load("selected/run", "/workflow", true);
	const overlapping = resource.load("selected/run", "/workflow", true);
	const manual = resource.load("selected/run", "/workflow");
	expect(overlapping).toBe(polling);
	expect(manual).toBe(polling);
	expect(resource.store.getState().entries["selected/run"]).toBe(original);
	update.resolve({ ...saved, publication: { ...saved.publication, savedAt: "newer" } });
	await polling;
	expect(inspections).toBe(INSPECTIONS);
	expect(
		snapshot(resource.store.getState().entries["selected/run"]!)?.native.publication.savedAt,
	).toBe("newer");
});

test("manual refresh promotes an overlapping unchanged probe to full inspection #test-631", async () => {
	const checkpoint = Promise.withResolvers<WorkflowLifecycle>();
	let inspections = 0;
	const resource = createWorkflowResource({
		inspect: () => {
			inspections += 1;
			return Promise.resolve(saved);
		},
		lifecycle: () => checkpoint.promise,
	});
	await resource.load("selected/run", "/workflow");
	const polling = resource.load("selected/run", "/workflow", true);
	expect(resource.load("selected/run", "/workflow")).toBe(polling);
	checkpoint.resolve(native);
	await polling;
	expect(inspections).toBe(INSPECTIONS);
});

test("an unchanged probe cannot clear a failed full inspection without successful inspection", async () => {
	let fail = false;
	const resource = createWorkflowResource({
		inspect: () => {
			if (fail) {
				return Promise.reject(new Error("Definition unavailable"));
			}
			return Promise.resolve(saved);
		},
		lifecycle: () => Promise.resolve(native),
	});
	await resource.load("selected/run", "/workflow");
	fail = true;
	await resource.load("selected/run", "/workflow");
	await resource.load("selected/run", "/workflow", true);
	expect(resource.store.getState().entries["selected/run"]?.kind).toBe("failed");
	fail = false;
	await resource.load("selected/run", "/workflow", true);
	expect(resource.store.getState().entries["selected/run"]?.kind).toBe("ready");
});

test.each(["lifecycle", "inspection"])(
	"polling recovers after a failed %s read with the snapshot intact",
	async (failure) => {
		let fail = false;
		const resource = createWorkflowResource({
			inspect: () => {
				if (fail && failure === "inspection") {
					return Promise.reject(new Error("Read failed"));
				}
				return Promise.resolve(saved);
			},
			lifecycle: () => {
				if (fail && failure === "lifecycle") {
					return Promise.reject(new Error("Read failed"));
				}
				return Promise.resolve({
					...native,
					publication: { ...native.publication, savedAt: "newer" },
				});
			},
		});
		await resource.load("selected/run", "/workflow");
		fail = true;
		await resource.load("selected/run", "/workflow", true);
		expect(resource.store.getState().entries["selected/run"]?.kind).toBe("failed");
		const view = snapshot(resource.store.getState().entries["selected/run"]!)!;
		expect(snapshot(view.diagram)).toBe(graph);
		fail = false;
		await resource.load("selected/run", "/workflow", true);
		expect(resource.store.getState().entries["selected/run"]?.kind).toBe("ready");
		const recovered = snapshot(resource.store.getState().entries["selected/run"]!)!;
		expect(snapshot(recovered.diagram)).toBe(graph);
	},
);

test.each([
	{ kind: "acknowledged", actor: "reviewer", acknowledgedAt: "later", reason: "Accepted" },
	{ kind: "superseded", replacementIds: ["replacement"] },
] satisfies WorkflowLifecycle["resolution"][])(
	"$kind refreshes native facts without replacing the graph",
	async (resolution) => {
		let current: WorkflowLifecycle = { ...native, resolution };
		let inspections = 0;
		const resource = createWorkflowResource({
			inspect: () => {
				inspections += 1;
				return Promise.resolve(saved);
			},
			lifecycle: () => Promise.resolve(current),
		});
		await resource.load("selected/run", "/workflow");
		const original = snapshot(resource.store.getState().entries["selected/run"]!)!;
		await resource.load("selected/run", "/workflow", true);
		const updated = snapshot(resource.store.getState().entries["selected/run"]!)!;
		expect(updated.native.resolution).toEqual(resolution);
		expect(updated.native.updatedAt).toBe(native.updatedAt);
		expect(updated.native.publication).toEqual(native.publication);
		expect(updated.diagram).toBe(original.diagram);
		expect(inspections).toBe(1);
		current = { ...current, publication: { ...native.publication, locked: true } };
		await resource.load("selected/run", "/workflow", true);
		expect(
			snapshot(resource.store.getState().entries["selected/run"]!)!.native.publication.locked,
		).toBe(true);
	},
);

test(
	"graph failure retains current lifecycle and last diagram " +
		"then recovers with unchanged native stamps",
	async () => {
		let unavailable = false;
		let inspections = 0;
		const resource = createWorkflowResource({
			inspect: () => {
				inspections += 1;
				if (unavailable) {
					return Promise.resolve({
						...saved,
						diagram: {
							kind: "unavailable",
							reason: "source_missing",
							message: "Definition unavailable",
						},
					});
				}
				return Promise.resolve(saved);
			},
			lifecycle: () => Promise.resolve(native),
		});
		await resource.load("selected/run", "/workflow");
		unavailable = true;
		await resource.load("selected/run", "/workflow");
		const failed = snapshot(resource.store.getState().entries["selected/run"]!)!;
		expect(failed.native).toEqual(native);
		expect(failed.diagram.kind).toBe("failed");
		expect(snapshot(failed.diagram)).toBe(graph);
		unavailable = false;
		await resource.load("selected/run", "/workflow", true);
		expect(inspections).toBe(RECOVERY_INSPECTIONS);
		expect(snapshot(resource.store.getState().entries["selected/run"]!)!.diagram.kind).toBe(
			"ready",
		);
	},
);

test("an initial graph failure exposes native facts without fabricating a graph", async () => {
	const resource = createWorkflowResource({
		inspect: () =>
			Promise.resolve({
				...saved,
				diagram: {
					kind: "unavailable",
					reason: "source_missing",
					message: "Definition unavailable",
				},
			}),
		lifecycle: () => Promise.resolve(native),
	});
	await resource.load("selected/run", "/workflow");
	const view = snapshot(resource.store.getState().entries["selected/run"]!)!;
	expect(view.native).toEqual(native);
	expect(view.diagram).toMatchObject({ kind: "failed", previous: null });
});

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
