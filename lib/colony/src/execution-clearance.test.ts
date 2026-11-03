/* eslint-disable unicorn/no-null -- Request and attempt absence are explicit authority facts. */
/* eslint-disable max-statements --
 * Authority scenarios keep complete memory setup and assertions in the measured body.
 */
import { COLONY_MANUAL_EXECUTION_PREFIX, readSpawnRequest } from "@hive/shared";
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import type { AttemptInventory } from "./store.ts";
import type { ExecutionClearanceRuntime } from "./execution-clearance.ts";
import type { LaunchReceipt } from "./launch.ts";
import { createAdmissionGate } from "./admission.ts";
import { executionClearance } from "./execution-clearance.ts";
import { newRequest } from "./request.ts";
import { trackerScope } from "./tracker.ts";

const ONE = 1;
const TWO = 2;

test("never-launched authority is independent of native request closure", async () => {
	const selected = await fixture();
	expect(await executionClearance(selected.selection, selected.runtime)).toMatchObject({
		result: {
			kind: "clear",
			requests: [{ id: selected.record!.id, proof: "never-launched", attemptIds: [] }],
		},
	});
	await selected.tracker.beads.close(selected.scope, selected.record!.id, {
		reason: "Stopped by Bee",
	});
	expect(await executionClearance(selected.selection, selected.runtime)).toMatchObject({
		result: { kind: "clear", requests: [{ proof: "never-launched" }] },
	});
	expect(selected.observed).toEqual([]);
});

test.each([
	{ kind: "foreign", reason: "foreign_or_unbound_host" },
	{ kind: "pending-claim", reason: "pending_claim" },
	{ kind: "manual", reason: "unsupported_manual_execution" },
	{ kind: "unregistered", reason: "unregistered_endpoint" },
])(
	"clearance refuses $kind authority without a process-exit inference",
	async ({ kind, reason }) => {
		const selected = await fixture();
		if (kind === "foreign") {
			selected.runtime.host = "another-host";
		}
		if (kind === "pending-claim") {
			selected.record!.context.pendingClaim = selected.run;
		}
		if (kind === "manual") {
			await selected.tracker.beads.comments.add(
				selected.scope,
				selected.record!.id,
				`${COLONY_MANUAL_EXECUTION_PREFIX}{"attemptId":"manual"}`,
			);
		}
		if (kind === "unregistered") {
			selected.runtime.registered = false;
		}
		expect(await executionClearance(selected.selection, selected.runtime)).toMatchObject({
			result: { kind: "refused", blockers: [{ reason }] },
		});
		expect(selected.observed).toEqual([]);
	},
);

test("clearance checks earlier exited attempts even after the current attempt and request settled", async () => {
	const selected = await fixture();
	selected.attempts.push(attempt(selected, "earlier"), attempt(selected, "current"));
	selected.record!.context.attempts = TWO;
	selected.record!.context.attemptId = "current";
	await selected.tracker.beads.close(selected.scope, selected.record!.id, {
		reason: "Stopped by Bee",
	});
	selected.runtime.observe = (receipt) => {
		selected.observed.push(receipt.id);
		let kind: "live" | "stopped" = "stopped";
		if (receipt.id === "earlier") {
			kind = "live";
		}
		return Promise.resolve({ kind });
	};
	expect(await executionClearance(selected.selection, selected.runtime)).toMatchObject({
		result: { kind: "refused", blockers: [{ reason: "live_execution", attemptId: "earlier" }] },
	});
	selected.runtime.observe = (receipt) => {
		selected.observed.push(receipt.id);
		return Promise.resolve({ kind: "stopped" });
	};
	expect(await executionClearance(selected.selection, selected.runtime)).toMatchObject({
		result: { kind: "clear", requests: [{ proof: "stopped", attemptIds: ["earlier", "current"] }] },
	});
	expect(selected.observed).toEqual(["earlier", "earlier", "current"]);
});

test("an in-flight admission becomes visible before a queued clearance observation", async () => {
	const selected = await fixture();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const admission = selected.runtime.withAdmission(async () => {
		entered.resolve();
		await release.promise;
		selected.attempts.push(attempt(selected, "reserved"));
		selected.record!.context.attempts = ONE;
		selected.record!.context.attemptId = "reserved";
	});
	await entered.promise;
	selected.runtime.observe = (receipt) => {
		selected.observed.push(receipt.id);
		return Promise.resolve({ kind: "live" });
	};
	const inspecting = executionClearance(selected.selection, selected.runtime);
	expect(selected.observed).toEqual([]);
	release.resolve();
	await admission;
	expect(await inspecting).toMatchObject({
		result: { kind: "refused", blockers: [{ reason: "live_execution", attemptId: "reserved" }] },
	});
	expect(selected.observed).toEqual(["reserved"]);
});

// --- Private functions ---

async function fixture(managed = true) {
	const tracker = memoryTracker();
	const scope = trackerScope(tracker.repository, "inspector");
	const run = await createTask(tracker);
	let record: ReturnType<typeof newRequest> | null = null;
	let request: ReturnType<typeof readSpawnRequest> | null = null;
	const records: ReturnType<typeof newRequest>[] = [];
	if (managed) {
		const id = await createSpawn(tracker, run);
		const native = await tracker.beads.show(scope, id);
		request = readSpawnRequest(native);
		record = newRequest(native, tracker.repository);
		records.push(record);
	}
	const attempts: AttemptInventory[] = [];
	const observed: string[] = [];
	const runtime: ExecutionClearanceRuntime = {
		...tracker,
		registered: true,
		host: request?.host ?? "fixture-host",
		now: () => "sampled",
		withAdmission: createAdmissionGate(),
		store: {
			requests: () => records,
			request: (_root, requestId) => records.find((value) => value.id === requestId),
			retainedInventory: () => attempts,
		},
		workflows: {
			inspect: () =>
				Promise.resolve({
					runId: run,
					nativeStatus: "in_progress",
					updatedAt: "sampled",
					publication: {
						checkpoint: "checkpoint",
						savedAt: "sampled",
						locked: true,
						settlement: "none",
					},
					lifecycle: { kind: "pending" },
					resolution: { kind: "unresolved" },
				}),
		},
		observe: (receipt) => {
			observed.push(receipt.id);
			return Promise.resolve({ kind: "stopped" });
		},
	};
	return {
		tracker,
		scope,
		run,
		record,
		request,
		records,
		attempts,
		observed,
		runtime,
		selection: { runId: run, anchorIds: [run] },
	};
}

function attempt(selected: Awaited<ReturnType<typeof fixture>>, id: string): AttemptInventory {
	const request = selected.request!;
	const receipt: LaunchReceipt = {
		assignment: request.assignment,
		attemptNumber: ONE,
		beadsDb: selected.tracker.repository.beadsDb,
		bucket: selected.tracker.repository.root,
		createdAt: "sampled",
		cwd: selected.tracker.repository.root,
		directory: `/fixture/${id}`,
		formula: { argv: [], executable: "fixture", headless: [] },
		host: request.host,
		id,
		identity: request.identity,
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: request.recipe,
		spawnId: selected.record!.id,
		taskIds: request.taskIds,
		token: "fixture-token",
	};
	return { id, spawnId: selected.record!.id, state: "exited", receipt };
}
