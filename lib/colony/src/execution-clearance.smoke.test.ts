/* eslint-disable unicorn/no-null -- Managed authority preserves absent policy and retry fields. */
/* eslint-disable import/no-nodejs-modules -- Verify actual owned processes using disposable artifacts. */
/* eslint-disable import/max-dependencies --
 * Join native request, public clearance and actual fingerprint verification.
 */
/* eslint-disable max-statements -- Keep the complete owned-process lifetime inside one measured acceptance scenario. */
import { createSpawn, createTask, memoryTracker } from "./tracker.test-support.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { observeExecution, runOwnedExecution } from "./processes.ts";
import type { LaunchReceipt } from "./launch.ts";
import { createAdmissionGate } from "./admission.ts";
import { executionClearance } from "./execution-clearance.ts";
import { join } from "node:path";
import { newRequest } from "./request.ts";
import { readSpawnRequest } from "@hive/shared";
import { tmpdir } from "node:os";
import { trackerScope } from "./tracker.ts";

test("#test-94 native request closure does not clear a real owned process until verified exit", async () => {
	const tracker = memoryTracker();
	const scope = trackerScope(tracker.repository, "inspector");
	const run = await createTask(tracker);
	const requestId = await createSpawn(tracker, run);
	const native = await tracker.beads.show(scope, requestId);
	const request = readSpawnRequest(native);
	const record = newRequest(native, tracker.repository);
	const directory = await mkdtemp(join(tmpdir(), "colony-clearance-owned-"));
	const receipt: LaunchReceipt = {
		assignment: request.assignment,
		attemptNumber: 1,
		beadsDb: tracker.repository.beadsDb,
		bucket: tracker.repository.root,
		createdAt: "sampled",
		cwd: tracker.repository.root,
		directory,
		formula: { argv: [], executable: "fixture", headless: [] },
		host: request.host,
		id: "owned-attempt",
		identity: request.identity,
		invocation: { argv: [], executable: "fixture" },
		policyRevisionId: null,
		recipe: request.recipe,
		spawnId: requestId,
		taskIds: request.taskIds,
		token: "owned-token",
	};
	record.context.attempts = 1;
	record.context.attemptId = receipt.id;
	record.state = "executing";
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const spawn = () =>
		Bun.spawn(
			[
				process.execPath,
				"-e",
				'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
			],
			{ stdin: "pipe", stdout: "ignore", stderr: "ignore" },
		);
	let child: ReturnType<typeof spawn> | null = null;
	const closeChild = () => {
		child?.stdin.end();
	};
	const execution = runOwnedExecution(
		receipt,
		() => {
			child = spawn();
			return child;
		},
		async () => {
			entered.resolve();
			await release.promise;
		},
	);
	try {
		await Promise.race([entered.promise, execution]);
		await tracker.beads.close(scope, requestId, { reason: "Stopped by Bee" });
		const runtime = {
			...tracker,
			registered: true,
			host: request.host!,
			now: () => "sampled",
			withAdmission: createAdmissionGate(),
			observe: observeExecution,
			store: {
				requests: () => [record],
				request: () => record,
				retainedInventory: () => [
					{ id: receipt.id, spawnId: requestId, state: "exited" as const, receipt },
				],
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
							settlement: "none" as const,
						},
						lifecycle: { kind: "pending" as const },
						resolution: { kind: "unresolved" as const },
					}),
			},
		};
		const selection = { runId: run, anchorIds: [run] };
		expect(await executionClearance(selection, runtime)).toMatchObject({
			result: { kind: "refused", blockers: [{ reason: "live_execution", attemptId: receipt.id }] },
		});
		closeChild();
		release.resolve();
		await execution;
		expect(await executionClearance(selection, runtime)).toMatchObject({
			result: {
				kind: "clear",
				requests: [{ id: requestId, proof: "stopped", attemptIds: [receipt.id] }],
			},
		});
	} finally {
		closeChild();
		release.resolve();
		await execution;
		await rm(directory, { force: true, recursive: true });
	}
});
